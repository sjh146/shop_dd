package handlers

import (
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

// TestCancelOrderSuccess — 소유자가 registered 주문 취소 → 200 + 재고 복원 SQL + 커밋.
func TestCancelOrderSuccess(t *testing.T) {
	gin.SetMode(gin.TestMode)

	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	now := time.Date(2026, 8, 17, 12, 0, 0, 0, time.UTC)

	mock.ExpectBegin()
	mock.ExpectQuery(`
		SELECT id, user_id, wallet_address, status, total_krw, total_usdc_micro,
		       COALESCE(gateway_order_id, ''), COALESCE(tx_hash, ''), created_at, updated_at
		FROM orders WHERE id = $1 FOR UPDATE
	`).WithArgs(5).WillReturnRows(orderSelectRows(models.Order{
		ID: 5, UserID: 7, WalletAddress: "0xbuyer", Status: "registered",
		TotalKRW: 13500, TotalUsdcMicro: 10_000_000, GatewayOrderID: "gw-5",
	}, now))
	mock.ExpectExec(`
		UPDATE orders SET status = 'cancelled', updated_at = NOW()
		WHERE id = $1 AND status IN ('pending', 'registered')
	`).WithArgs(5).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`
		UPDATE products p SET stock = p.stock + oi.qty, updated_at = NOW()
		FROM order_items oi
		WHERE oi.order_id = $1 AND oi.product_id = p.id
	`).WithArgs(5).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	router := gin.New()
	router.POST("/api/orders/:id/cancel", func(c *gin.Context) {
		c.Set("userId", 7)
		c.Next()
	}, CancelOrder(db))

	req := httptest.NewRequest(http.MethodPost, "/api/orders/5/cancel", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Order models.Order `json:"order"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Order.Status != "cancelled" {
		t.Errorf("status = %q, want cancelled", resp.Order.Status)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
}

// TestCancelOrderNonOwner — 타인 주문 취소 → 403.
func TestCancelOrderNonOwner(t *testing.T) {
	gin.SetMode(gin.TestMode)

	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	now := time.Date(2026, 8, 17, 12, 0, 0, 0, time.UTC)
	mock.ExpectBegin()
	mock.ExpectQuery(`
		SELECT id, user_id, wallet_address, status, total_krw, total_usdc_micro,
		       COALESCE(gateway_order_id, ''), COALESCE(tx_hash, ''), created_at, updated_at
		FROM orders WHERE id = $1 FOR UPDATE
	`).WithArgs(5).WillReturnRows(orderSelectRows(models.Order{
		ID: 5, UserID: 99, WalletAddress: "0xother", Status: "pending",
		TotalKRW: 13500, TotalUsdcMicro: 10_000_000,
	}, now))
	mock.ExpectRollback()

	router := gin.New()
	router.POST("/api/orders/:id/cancel", func(c *gin.Context) {
		c.Set("userId", 7)
		c.Next()
	}, CancelOrder(db))

	req := httptest.NewRequest(http.MethodPost, "/api/orders/5/cancel", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403; body=%s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
}

// TestCancelOrderPaid — paid 주문 취소 → 409 (재고 복원 금지).
func TestCancelOrderPaid(t *testing.T) {
	gin.SetMode(gin.TestMode)

	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	now := time.Date(2026, 8, 17, 12, 0, 0, 0, time.UTC)
	mock.ExpectBegin()
	mock.ExpectQuery(`
		SELECT id, user_id, wallet_address, status, total_krw, total_usdc_micro,
		       COALESCE(gateway_order_id, ''), COALESCE(tx_hash, ''), created_at, updated_at
		FROM orders WHERE id = $1 FOR UPDATE
	`).WithArgs(5).WillReturnRows(orderSelectRows(models.Order{
		ID: 5, UserID: 7, WalletAddress: "0xbuyer", Status: "paid",
		TotalKRW: 13500, TotalUsdcMicro: 10_000_000, TxHash: "0xpaid",
	}, now))
	mock.ExpectRollback()

	router := gin.New()
	router.POST("/api/orders/:id/cancel", func(c *gin.Context) {
		c.Set("userId", 7)
		c.Next()
	}, CancelOrder(db))

	req := httptest.NewRequest(http.MethodPost, "/api/orders/5/cancel", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
}

// TestCancelOrderIdempotent — 이미 cancelled 주문 재취소 → 200 멱등 (재고 복원 없음).
func TestCancelOrderIdempotent(t *testing.T) {
	gin.SetMode(gin.TestMode)

	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	now := time.Date(2026, 8, 17, 12, 0, 0, 0, time.UTC)
	mock.ExpectBegin()
	mock.ExpectQuery(`
		SELECT id, user_id, wallet_address, status, total_krw, total_usdc_micro,
		       COALESCE(gateway_order_id, ''), COALESCE(tx_hash, ''), created_at, updated_at
		FROM orders WHERE id = $1 FOR UPDATE
	`).WithArgs(5).WillReturnRows(orderSelectRows(models.Order{
		ID: 5, UserID: 7, WalletAddress: "0xbuyer", Status: "cancelled",
		TotalKRW: 13500, TotalUsdcMicro: 10_000_000,
	}, now))
	mock.ExpectCommit()

	router := gin.New()
	router.POST("/api/orders/:id/cancel", func(c *gin.Context) {
		c.Set("userId", 7)
		c.Next()
	}, CancelOrder(db))

	req := httptest.NewRequest(http.MethodPost, "/api/orders/5/cancel", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
}

// TestCancelOrderUnauthorized — JWT 없이 취소 → 401.
func TestCancelOrderUnauthorized(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	router := gin.New()
	router.POST("/api/orders/:id/cancel", CancelOrder(db))
	req := httptest.NewRequest(http.MethodPost, "/api/orders/5/cancel", strings.NewReader(""))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}
