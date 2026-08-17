package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

// TestCreateOrder verifies the full order creation flow: product validation,
// KRW→USDC conversion, order + items insert, and gateway registration.
func TestCreateOrder(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// Fake blockchain-gateway server.
	gw := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/internal/blockchain/payment/register" {
			t.Errorf("unexpected gateway path: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if r.Header.Get("X-Internal-Api-Key") != "test-internal-key" {
			t.Errorf("missing/wrong internal api key: %q", r.Header.Get("X-Internal-Api-Key"))
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true,"order_id":"gw-12345"}`))
	}))
	defer gw.Close()

	t.Setenv("BLOCKCHAIN_GATEWAY_URL", gw.URL)
	t.Setenv("INTERNAL_API_KEY", "test-internal-key")
	t.Setenv("PAYMENT_CONTRACT_ADDRESS", "0xContract")
	t.Setenv("USDC_TOKEN_ADDRESS", "0xUsdc")

	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("failed to create sqlmock: %v", err)
	}
	defer db.Close()

	now := time.Date(2026, 8, 17, 12, 0, 0, 0, time.UTC)

	// ① 트랜잭션 시작
	mock.ExpectBegin()

	// ② 재고 원자 차감 (UPDATE ... RETURNING) — totalKRW = 13500*2 = 27000
	productRows := sqlmock.NewRows([]string{"title", "sale_price_krw"}).
		AddRow("Test Product", 13500)
	mock.ExpectQuery(`
		UPDATE products SET stock = stock - $1, updated_at = NOW()
		WHERE id = $2 AND status = 'listed' AND stock >= $1
		RETURNING title, COALESCE(sale_price_krw, 0)
	`).WithArgs(2, 1).WillReturnRows(productRows)

	// ③ Order insert. totalKRW = 13500*2 = 27000, totalUsdcMicro = 20_000_000.
	orderRows := sqlmock.NewRows([]string{
		"id", "user_id", "wallet_address", "status", "total_krw", "total_usdc_micro",
		"gateway_order_id", "tx_hash", "created_at", "updated_at",
	}).
		AddRow(42, 7, "0xabc...", "pending", 27000, 20_000_000, "", "", now, now)
	mock.ExpectQuery(`
		INSERT INTO orders (user_id, wallet_address, status, total_krw, total_usdc_micro)
		VALUES ($1, $2, 'pending', $3, $4)
		RETURNING id, user_id, wallet_address, status, total_krw, total_usdc_micro,
		          COALESCE(gateway_order_id, ''), COALESCE(tx_hash, ''), created_at, updated_at
	`).WithArgs(7, "0xabc...", 27000, int64(20_000_000)).WillReturnRows(orderRows)

	// ④ order_items insert (같은 트랜잭션).
	mock.ExpectExec(`
		INSERT INTO order_items (order_id, product_id, title, price_krw, qty)
		VALUES ($1, $2, $3, $4, $5)
	`).WithArgs(42, 1, "Test Product", 13500, 2).WillReturnResult(sqlmock.NewResult(1, 1))

	mock.ExpectCommit()

	// ⑤ Gateway register success → UPDATE orders to registered.
	mock.ExpectExec(`
		UPDATE orders SET status = 'registered', gateway_order_id = $1, updated_at = NOW()
		WHERE id = $2
	`).WithArgs("gw-12345", 42).WillReturnResult(sqlmock.NewResult(0, 1))

	// Build router with auth context injected.
	router := gin.New()
	router.POST("/api/orders", func(c *gin.Context) {
		c.Set("userId", 7)
		c.Set("walletAddress", "0xabc...")
		c.Next()
	}, CreateOrder(db))

	body := `{"items":[{"productId":1,"qty":2}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/orders", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", w.Code, w.Body.String())
	}

	var resp modelsCreateOrderResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal response: %v; body=%s", err, w.Body.String())
	}

	if resp.OrderID != 42 {
		t.Errorf("order_id = %d, want 42", resp.OrderID)
	}
	if resp.AmountUsdcMicro != 20_000_000 {
		t.Errorf("amount_usdc_micro = %d, want 20000000", resp.AmountUsdcMicro)
	}
	if resp.GatewayOrderID != "gw-12345" {
		t.Errorf("gateway_order_id = %q, want gw-12345", resp.GatewayOrderID)
	}
	if resp.ContractAddress != "0xContract" {
		t.Errorf("contract_address = %q, want 0xContract", resp.ContractAddress)
	}
	if resp.UsdcToken != "0xUsdc" {
		t.Errorf("usdc_token = %q, want 0xUsdc", resp.UsdcToken)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
}

// TestCreateOrderGatewayDown verifies that when the gateway is unreachable the
// order is still created (pending) and the response reflects no gateway id.
func TestCreateOrderGatewayDown(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// Point gateway at a closed server so register fails.
	gw := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	gwURL := gw.URL
	gw.Close() // close immediately → connection refused

	t.Setenv("BLOCKCHAIN_GATEWAY_URL", gwURL)
	t.Setenv("INTERNAL_API_KEY", "test-internal-key")
	t.Setenv("PAYMENT_CONTRACT_ADDRESS", "0xContract")
	t.Setenv("USDC_TOKEN_ADDRESS", "0xUsdc")

	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("failed to create sqlmock: %v", err)
	}
	defer db.Close()

	now := time.Date(2026, 8, 17, 12, 0, 0, 0, time.UTC)

	mock.ExpectBegin()

	productRows := sqlmock.NewRows([]string{"title", "sale_price_krw"}).
		AddRow("Test Product", 13500)
	mock.ExpectQuery(`
		UPDATE products SET stock = stock - $1, updated_at = NOW()
		WHERE id = $2 AND status = 'listed' AND stock >= $1
		RETURNING title, COALESCE(sale_price_krw, 0)
	`).WithArgs(1, 1).WillReturnRows(productRows)

	orderRows := sqlmock.NewRows([]string{
		"id", "user_id", "wallet_address", "status", "total_krw", "total_usdc_micro",
		"gateway_order_id", "tx_hash", "created_at", "updated_at",
	}).
		AddRow(43, 7, "0xabc...", "pending", 13500, 10_000_000, "", "", now, now)
	mock.ExpectQuery(`
		INSERT INTO orders (user_id, wallet_address, status, total_krw, total_usdc_micro)
		VALUES ($1, $2, 'pending', $3, $4)
		RETURNING id, user_id, wallet_address, status, total_krw, total_usdc_micro,
		          COALESCE(gateway_order_id, ''), COALESCE(tx_hash, ''), created_at, updated_at
	`).WithArgs(7, "0xabc...", 13500, int64(10_000_000)).WillReturnRows(orderRows)

	mock.ExpectExec(`
		INSERT INTO order_items (order_id, product_id, title, price_krw, qty)
		VALUES ($1, $2, $3, $4, $5)
	`).WithArgs(43, 1, "Test Product", 13500, 1).WillReturnResult(sqlmock.NewResult(1, 1))

	mock.ExpectCommit()

	// No UPDATE expected — gateway failed, order stays pending.

	router := gin.New()
	router.POST("/api/orders", func(c *gin.Context) {
		c.Set("userId", 7)
		c.Set("walletAddress", "0xabc...")
		c.Next()
	}, CreateOrder(db))

	body := `{"items":[{"productId":1,"qty":1}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/orders", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", w.Code, w.Body.String())
	}

	var resp modelsCreateOrderResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal response: %v; body=%s", err, w.Body.String())
	}
	if resp.OrderID != 43 {
		t.Errorf("order_id = %d, want 43", resp.OrderID)
	}
	if resp.GatewayOrderID != "" {
		t.Errorf("gateway_order_id = %q, want empty (gateway down)", resp.GatewayOrderID)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
}

// TestCreateOrderUnauthorized verifies the handler rejects requests without a
// userId in context.
func TestCreateOrderUnauthorized(t *testing.T) {
	gin.SetMode(gin.TestMode)

	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create sqlmock: %v", err)
	}
	defer db.Close()

	router := gin.New()
	router.POST("/api/orders", CreateOrder(db))

	body := `{"items":[{"productId":1,"qty":1}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/orders", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401; body=%s", w.Code, w.Body.String())
	}
}

// modelsCreateOrderResponse mirrors models.CreateOrderResponse for JSON decode.
type modelsCreateOrderResponse struct {
	OrderID         int    `json:"order_id"`
	AmountUsdcMicro int64  `json:"amount_usdc_micro"`
	GatewayOrderID  string `json:"gateway_order_id"`
	ContractAddress string `json:"contract_address"`
	UsdcToken       string `json:"usdc_token"`
}
