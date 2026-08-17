package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

// TestGetProducts verifies the GET /api/products handler returns only
// listed products with the expected JSON shape.
func TestGetProducts(t *testing.T) {
	gin.SetMode(gin.TestMode)

	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("failed to create sqlmock: %v", err)
	}
	defer db.Close()

	now := time.Date(2026, 8, 17, 12, 0, 0, 0, time.UTC)

	// Expect the products query and return two listed rows.
	rows := sqlmock.NewRows([]string{
		"id", "selling_product_id", "title", "description", "image_url", "source_url",
		"sale_price_krw", "original_price_krw", "margin_pct", "volume", "status",
		"stock", "synced_at", "created_at", "updated_at",
	}).
		AddRow(2, 200, "Product B", "desc b", "img-b.jpg", "src-b", 13500, 20000, "10", 5, "listed", 3, now, now, now).
		AddRow(1, 100, "Product A", "desc a", "img-a.jpg", "src-a", 27000, 30000, "20", 8, "listed", 10, now, now, now)

	mock.ExpectQuery(`
		SELECT id, selling_product_id, title, COALESCE(description, ''),
		       COALESCE(image_url, ''), COALESCE(source_url, ''),
		       COALESCE(sale_price_krw, 0), COALESCE(original_price_krw, 0),
		       COALESCE(margin_pct, ''), COALESCE(volume, 0), status,
		       COALESCE(stock, 1), synced_at, created_at, updated_at
		FROM products
		WHERE status = 'listed'
		ORDER BY id DESC
	`).WillReturnRows(rows)

	// Build the gin context.
	router := gin.New()
	router.GET("/api/products", GetProducts(db))

	req := httptest.NewRequest(http.MethodGet, "/api/products", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}

	var resp struct {
		Products []struct {
			ID              int    `json:"id"`
			SellingProductID int   `json:"sellingProductId"`
			Title           string `json:"title"`
			SalePriceKRW    *int   `json:"salePriceKrw"`
			Status          string `json:"status"`
			Stock           int    `json:"stock"`
		} `json:"products"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal response: %v; body=%s", err, w.Body.String())
	}

	if len(resp.Products) != 2 {
		t.Fatalf("got %d products, want 2", len(resp.Products))
	}

	// id DESC ordering → first product is id=2.
	first := resp.Products[0]
	if first.ID != 2 || first.Title != "Product B" {
		t.Errorf("first product = %+v, want id=2 title=Product B", first)
	}
	if first.SalePriceKRW == nil || *first.SalePriceKRW != 13500 {
		t.Errorf("first product salePriceKrw = %v, want 13500", first.SalePriceKRW)
	}
	if first.Status != "listed" || first.Stock != 3 {
		t.Errorf("first product status/stock = %s/%d, want listed/3", first.Status, first.Stock)
	}

	second := resp.Products[1]
	if second.ID != 1 || second.Title != "Product A" {
		t.Errorf("second product = %+v, want id=1 title=Product A", second)
	}
	if second.SalePriceKRW == nil || *second.SalePriceKRW != 27000 {
		t.Errorf("second product salePriceKrw = %v, want 27000", second.SalePriceKRW)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
}

// TestGetProductsEmpty verifies the handler returns an empty list when no
// products are listed.
func TestGetProductsEmpty(t *testing.T) {
	gin.SetMode(gin.TestMode)

	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("failed to create sqlmock: %v", err)
	}
	defer db.Close()

	rows := sqlmock.NewRows([]string{
		"id", "selling_product_id", "title", "description", "image_url", "source_url",
		"sale_price_krw", "original_price_krw", "margin_pct", "volume", "status",
		"stock", "synced_at", "created_at", "updated_at",
	})
	mock.ExpectQuery(`
		SELECT id, selling_product_id, title, COALESCE(description, ''),
		       COALESCE(image_url, ''), COALESCE(source_url, ''),
		       COALESCE(sale_price_krw, 0), COALESCE(original_price_krw, 0),
		       COALESCE(margin_pct, ''), COALESCE(volume, 0), status,
		       COALESCE(stock, 1), synced_at, created_at, updated_at
		FROM products
		WHERE status = 'listed'
		ORDER BY id DESC
	`).WillReturnRows(rows)

	router := gin.New()
	router.GET("/api/products", GetProducts(db))

	req := httptest.NewRequest(http.MethodGet, "/api/products", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}

	var resp struct {
		Products []interface{} `json:"products"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if len(resp.Products) != 0 {
		t.Errorf("got %d products, want 0", len(resp.Products))
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
}
