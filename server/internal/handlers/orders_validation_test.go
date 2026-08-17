package handlers

// Targeted validation tests for the Orders/Payments business-logic layer.
// These prove business-logic / auth-trust issues in CreateOrder/VerifyOrder
// and the wallet-auth gate; they do not modify production code.

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"shop-dd/internal/models"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

func orderInsertRows(id, userID int, wallet string, totalKRW int, totalUsdcMicro int64, created time.Time) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "user_id", "wallet_address", "status", "total_krw", "total_usdc_micro",
		"gateway_order_id", "tx_hash", "created_at", "updated_at",
	}).AddRow(id, userID, wallet, "pending", totalKRW, totalUsdcMicro, "", "", created, created)
}

func orderSelectRows(order models.Order, created time.Time) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "user_id", "wallet_address", "status", "total_krw", "total_usdc_micro",
		"gateway_order_id", "tx_hash", "created_at", "updated_at",
	}).AddRow(order.ID, order.UserID, order.WalletAddress, order.Status,
		order.TotalKRW, order.TotalUsdcMicro, order.GatewayOrderID, order.TxHash, created, created)
}

// TestVerifyOrderOwnershipEnforced confirms the IDOR guard on
// POST /api/orders/:id/verify rejects a non-owner, i.e. the authorization
// check itself is present and effective (not exploitable via simple IDOR).
func TestVerifyOrderOwnershipEnforced(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	now := time.Date(2026, 8, 17, 12, 0, 0, 0, time.UTC)
	// order id=5 belongs to user 99; requester is user 7
	mock.ExpectQuery(`
		SELECT id, user_id, wallet_address, status, total_krw, total_usdc_micro,
		       COALESCE(gateway_order_id, ''), COALESCE(tx_hash, ''), created_at, updated_at
		FROM orders WHERE id = $1
	`).WithArgs(5).WillReturnRows(orderSelectRows(models.Order{
		ID: 5, UserID: 99, WalletAddress: "0xvictim", Status: "registered", TotalKRW: 13500, TotalUsdcMicro: 10_000_000,
	}, now))

	router := gin.New()
	router.POST("/api/orders/:id/verify", func(c *gin.Context) {
		c.Set("userId", 7)
		c.Next()
	}, VerifyOrder(db))

	req := httptest.NewRequest(http.MethodPost, "/api/orders/5/verify", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403; body=%s", w.Code, w.Body.String())
	}
	t.Log("OK: VerifyOrder rejects non-owner (403) — IDOR guard present")
}

// TestGetOrderOwnershipEnforced confirms GET /api/orders/:id enforces the same
// ownership check.
func TestGetOrderOwnershipEnforced(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	now := time.Date(2026, 8, 17, 12, 0, 0, 0, time.UTC)
	mock.ExpectQuery(`
		SELECT id, user_id, wallet_address, status, total_krw, total_usdc_micro,
		       COALESCE(gateway_order_id, ''), COALESCE(tx_hash, ''), created_at, updated_at
		FROM orders WHERE id = $1
	`).WithArgs(5).WillReturnRows(orderSelectRows(models.Order{
		ID: 5, UserID: 99, WalletAddress: "0xvictim", Status: "registered", TotalKRW: 13500, TotalUsdcMicro: 10_000_000,
	}, now))

	router := gin.New()
	router.GET("/api/orders/:id", func(c *gin.Context) {
		c.Set("userId", 7)
		c.Next()
	}, GetOrder(db))

	req := httptest.NewRequest(http.MethodGet, "/api/orders/5", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403; body=%s", w.Code, w.Body.String())
	}
	t.Log("OK: GetOrder rejects non-owner (403)")
}

// TestCreateOrderNoStockDecrementAndDuplicateItems proves two issues:
// (1) the handler performs no stock reservation/decrement anywhere — the
// only SQL against products is the read; and (2) sending the same productId
// twice passes the stock check independently for each line, so cumulative
// TestCreateOrderDuplicateLinesRejected — CWE-639 회귀 테스트:
// 중복 productId 라인은 합산되어 재고 검증에 사용 → 총 수량이 재고(5)를
// 초과하면 400 + 롤백 (주문/아이템 INSERT 발생 금지, 재고 미차감).
func TestCreateOrderDuplicateLinesRejected(t *testing.T) {
	gin.SetMode(gin.TestMode)

	gw := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true,"order_id":"gw-1"}`))
	}))
	defer gw.Close()
	t.Setenv("BLOCKCHAIN_GATEWAY_URL", gw.URL)
	t.Setenv("INTERNAL_API_KEY", "k")

	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	// [{productId:1,qty:3},{productId:1,qty:3}] → 합산 qty=6 > stock=5.
	// 원자 UPDATE는 0행 (재고 부족) → 원인 조회 → 400 + 롤백.
	mock.ExpectBegin()
	mock.ExpectQuery(`
		UPDATE products SET stock = stock - $1, updated_at = NOW()
		WHERE id = $2 AND status = 'listed' AND stock >= $1
		RETURNING title, COALESCE(sale_price_krw, 0)
	`).WithArgs(6, 1).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(`
		SELECT status, COALESCE(stock, 0) FROM products WHERE id = $1
	`).WithArgs(1).
		WillReturnRows(sqlmock.NewRows([]string{"status", "stock"}).AddRow("listed", 5))
	mock.ExpectRollback()

	router := gin.New()
	router.POST("/api/orders", func(c *gin.Context) {
		c.Set("userId", 7)
		c.Set("walletAddress", "0xbuyer")
		c.Next()
	}, CreateOrder(db))

	body := `{"items":[{"productId":1,"qty":3},{"productId":1,"qty":3}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/orders", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", w.Code, w.Body.String())
	}

	// 롤백이 정상 수행됐는지 + 예상치 못한 SQL(주문 INSERT 등)이 없었는지 확인.
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
	t.Log("OK: duplicate lines aggregated (qty 6 > stock 5) → 400 + rollback, no order created")
}

// TestCreateOrderStockDecremented — CWE-639 회귀 테스트 (정상 경로):
// 주문 생성 시 재고가 원자적으로 차감되고, 부분 실패 시 롤백된다.
func TestCreateOrderStockDecremented(t *testing.T) {
	gin.SetMode(gin.TestMode)

	gw := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true,"order_id":"gw-1"}`))
	}))
	defer gw.Close()
	t.Setenv("BLOCKCHAIN_GATEWAY_URL", gw.URL)
	t.Setenv("INTERNAL_API_KEY", "k")

	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	now := time.Date(2026, 8, 17, 12, 0, 0, 0, time.UTC)

	// [{1,3},{1,2}] → 합산 qty=5 ≤ stock 5 → 성공 + 단일 차감 UPDATE.
	mock.ExpectBegin()
	productRows := sqlmock.NewRows([]string{"title", "sale_price_krw"}).
		AddRow("Widget", 13500)
	mock.ExpectQuery(`
		UPDATE products SET stock = stock - $1, updated_at = NOW()
		WHERE id = $2 AND status = 'listed' AND stock >= $1
		RETURNING title, COALESCE(sale_price_krw, 0)
	`).WithArgs(5, 1).WillReturnRows(productRows)

	mock.ExpectQuery(`
		INSERT INTO orders (user_id, wallet_address, status, total_krw, total_usdc_micro)
		VALUES ($1, $2, 'pending', $3, $4)
		RETURNING id, user_id, wallet_address, status, total_krw, total_usdc_micro,
		          COALESCE(gateway_order_id, ''), COALESCE(tx_hash, ''), created_at, updated_at
	`).WithArgs(7, "0xbuyer", 13500*5, int64(krwToUsdcMicro(13500*5))).WillReturnRows(orderInsertRows(9, 7, "0xbuyer", 13500*5, krwToUsdcMicro(13500*5), now))

	// 합산된 단일 order_items 행 (qty=5)
	mock.ExpectExec(`
		INSERT INTO order_items (order_id, product_id, title, price_krw, qty)
		VALUES ($1, $2, $3, $4, $5)
	`).WithArgs(9, 1, "Widget", 13500, 5).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	mock.ExpectExec(`
		UPDATE orders SET status = 'registered', gateway_order_id = $1, updated_at = NOW()
		WHERE id = $2
	`).WithArgs("gw-1", 9).WillReturnResult(sqlmock.NewResult(0, 1))

	router := gin.New()
	router.POST("/api/orders", func(c *gin.Context) {
		c.Set("userId", 7)
		c.Set("walletAddress", "0xbuyer")
		c.Next()
	}, CreateOrder(db))

	body := `{"items":[{"productId":1,"qty":3},{"productId":1,"qty":2}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/orders", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", w.Code, w.Body.String())
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
	t.Log("OK: qty 3+2 aggregated to 5, single atomic stock decrement, single order_items row")
}

// TestCreateOrderZeroPriceFreeOrder proves a listed product with no price
// (NULL -> COALESCE 0) yields a zero-amount order, so the KRW/USDC total is 0
// and the resulting order requires no meaningful on-chain payment.
func TestCreateOrderZeroPriceFreeOrder(t *testing.T) {
	gin.SetMode(gin.TestMode)

	gw := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true,"order_id":"gw-0"}`))
	}))
	defer gw.Close()
	t.Setenv("BLOCKCHAIN_GATEWAY_URL", gw.URL)
	t.Setenv("INTERNAL_API_KEY", "k")

	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	now := time.Date(2026, 8, 17, 12, 0, 0, 0, time.UTC)
	// Product NULL price -> COALESCE(sale_price_krw,0) = 0, status=listed, stock=1
	mock.ExpectBegin()
	prodRows := sqlmock.NewRows([]string{"title", "sale_price_krw"}).
		AddRow("Freebie", 0)
	mock.ExpectQuery(`
		UPDATE products SET stock = stock - $1, updated_at = NOW()
		WHERE id = $2 AND status = 'listed' AND stock >= $1
		RETURNING title, COALESCE(sale_price_krw, 0)
	`).WithArgs(1, 1).WillReturnRows(prodRows)

	mock.ExpectQuery(`
		INSERT INTO orders (user_id, wallet_address, status, total_krw, total_usdc_micro)
		VALUES ($1, $2, 'pending', $3, $4)
		RETURNING id, user_id, wallet_address, status, total_krw, total_usdc_micro,
		          COALESCE(gateway_order_id, ''), COALESCE(tx_hash, ''), created_at, updated_at
	`).WithArgs(7, "0xbuyer", 0, int64(0)).WillReturnRows(orderInsertRows(10, 7, "0xbuyer", 0, 0, now))
	mock.ExpectExec(`
		INSERT INTO order_items (order_id, product_id, title, price_krw, qty)
		VALUES ($1, $2, $3, $4, $5)
	`).WithArgs(10, 1, "Freebie", 0, 1).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
	mock.ExpectExec(`
		UPDATE orders SET status = 'registered', gateway_order_id = $1, updated_at = NOW()
		WHERE id = $2
	`).WithArgs("gw-0", 10).WillReturnResult(sqlmock.NewResult(0, 1))

	router := gin.New()
	router.POST("/api/orders", func(c *gin.Context) {
		c.Set("userId", 7)
		c.Set("walletAddress", "0xbuyer")
		c.Next()
	}, CreateOrder(db))

	req := httptest.NewRequest(http.MethodPost, "/api/orders", strings.NewReader(`{"items":[{"productId":1,"qty":1}]}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", w.Code, w.Body.String())
	}
	var resp modelsCreateOrderResponse
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.AmountUsdcMicro != 0 {
		t.Errorf("amount_usdc_micro = %d, want 0 (zero-price order)", resp.AmountUsdcMicro)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
	t.Log("OK: listed product with NULL price produced a zero-amount (free) order")
}

// TestVerifyOrderReVerifyPaidIdempotent — CWE-754 회귀 테스트:
// 이미 paid인 주문을 재검증해도 상태 전이 가드(WHERE status <> 'paid')로
// tx_hash가 덮어써지지 않고, 응답에도 기존 DB 상태가 그대로 반환된다.
func TestVerifyOrderReVerifyPaidIdempotent(t *testing.T) {
	gin.SetMode(gin.TestMode)

	gw := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"verified":true,"tx_hash":"0xdeadbeef","order_id":"5","payer":"0xbuyer","amount_usdc":"10000000","chain_id":84532}`))
	}))
	defer gw.Close()
	t.Setenv("BLOCKCHAIN_GATEWAY_URL", gw.URL)
	t.Setenv("INTERNAL_API_KEY", "k")

	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	now := time.Date(2026, 8, 17, 12, 0, 0, 0, time.UTC)
	// Order already paid (status=paid, tx_hash=0xold)
	mock.ExpectQuery(`
		SELECT id, user_id, wallet_address, status, total_krw, total_usdc_micro,
		       COALESCE(gateway_order_id, ''), COALESCE(tx_hash, ''), created_at, updated_at
		FROM orders WHERE id = $1
	`).WithArgs(5).WillReturnRows(orderSelectRows(models.Order{
		ID: 5, UserID: 7, WalletAddress: "0xbuyer", Status: "paid",
		TotalKRW: 13500, TotalUsdcMicro: 10_000_000, TxHash: "0xold",
	}, now))
	// 상태 전이 가드: 이미 paid → 0행 갱신
	mock.ExpectExec(`
		UPDATE orders SET status = 'paid', tx_hash = $1, updated_at = NOW() WHERE id = $2 AND status <> 'paid'
	`).WithArgs("0xdeadbeef", 5).WillReturnResult(sqlmock.NewResult(0, 0))
	// 응답 오염 방지용 DB 재조회 — 기존 상태 유지
	mock.ExpectQuery(`
		SELECT id, user_id, wallet_address, status, total_krw, total_usdc_micro,
		       COALESCE(gateway_order_id, ''), COALESCE(tx_hash, ''), created_at, updated_at
		FROM orders WHERE id = $1
	`).WithArgs(5).WillReturnRows(orderSelectRows(models.Order{
		ID: 5, UserID: 7, WalletAddress: "0xbuyer", Status: "paid",
		TotalKRW: 13500, TotalUsdcMicro: 10_000_000, TxHash: "0xold",
	}, now))

	router := gin.New()
	router.POST("/api/orders/:id/verify", func(c *gin.Context) {
		c.Set("userId", 7)
		c.Next()
	}, VerifyOrder(db))

	req := httptest.NewRequest(http.MethodPost, "/api/orders/5/verify", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}

	// 응답에 기존 tx_hash(0xold)가 유지되어야 함 — 재검증 덮어쓰기 금지
	var resp struct {
		Order models.Order `json:"order"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v; body=%s", err, w.Body.String())
	}
	if resp.Order.TxHash != "0xold" {
		t.Errorf("tx_hash = %q, want 0xold (paid order must not be overwritten by re-verify)", resp.Order.TxHash)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
	t.Log("OK: re-verify on paid order is idempotent — tx_hash preserved")
}