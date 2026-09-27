package handlers

// Tests for the optional US shipping address on orders:
//   POST /api/orders   → req.shipping (validated server-side, persisted to ship_* columns)
//   GET  /api/orders/:id → order.shipping (nil/omitted for legacy rows where ship_* is NULL)
// shipping 없이 주문하면 기존과 완전히 동일하게 동작해야 한다(하위 호환).

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

const (
	// orders SELECT/RETURNING 공통 컬럼 목록 (production의 orderSelectColumns와 동일해야 함)
	shippingSelectSQL = `
		SELECT id, user_id, wallet_address, status, total_krw, total_usdc_micro,
		       COALESCE(gateway_order_id, ''), COALESCE(tx_hash, ''), created_at, updated_at,
		       ship_name, ship_phone, ship_address1, ship_address2, ship_city, ship_state, ship_zip
		FROM orders WHERE id = $1
	`
	shippingItemsSQL = `
		SELECT id, order_id, product_id, title, price_krw, qty
		FROM order_items WHERE order_id = $1
	`
)

// validShipping — 모든 규칙을 통과하는 기준 배송지.
func validShipping() models.ShippingInfo {
	return models.ShippingInfo{
		Name:     "Alice Kim",
		Phone:    "415-555-0123",
		Address1: "1 Market St, Apt 5",
		Address2: "Unit 5",
		City:     "San Francisco",
		State:    "CA",
		Zip:      "94105",
	}
}

// orderRowsWithShipping — ship_* 컬럼이 채워진 orders 행.
func orderRowsWithShipping(id, userID int, wallet string, totalKRW int, totalUsdcMicro int64, s *models.ShippingInfo, created time.Time) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "user_id", "wallet_address", "status", "total_krw", "total_usdc_micro",
		"gateway_order_id", "tx_hash", "created_at", "updated_at",
		"ship_name", "ship_phone", "ship_address1", "ship_address2", "ship_city", "ship_state", "ship_zip",
	}).AddRow(id, userID, wallet, "pending", totalKRW, totalUsdcMicro, "", "", created, created,
		s.Name, s.Phone, s.Address1, shipNull(s.Address2), s.City, s.State, s.Zip)
}

// createOrderBody — 주문 생성 요청 본문.
func createOrderBody(t *testing.T, ship *models.ShippingInfo) *strings.Reader {
	t.Helper()
	b, err := json.Marshal(models.CreateOrderRequest{
		Items:    []models.OrderItemRequest{{ProductID: 1, Qty: 1}},
		Shipping: ship,
	})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	return strings.NewReader(string(b))
}

// TestValidateShipping — 테이블 구동 검증 규칙 테스트.
func TestValidateShipping(t *testing.T) {
	with := func(mutate func(s *models.ShippingInfo)) *models.ShippingInfo {
		s := validShipping()
		mutate(&s)
		return &s
	}
	long := strings.Repeat("x", 201)

	cases := []struct {
		name  string
		ship  *models.ShippingInfo
		want  string // 위반 메시지 ("" = 통과)
		valid bool
	}{
		{"valid address", with(func(s *models.ShippingInfo) {}), "", true},
		{"valid ZIP+4", with(func(s *models.ShippingInfo) { s.Zip = "94105-1234" }), "", true},
		{"valid territory code", with(func(s *models.ShippingInfo) { s.State = "PR" }), "", true},
		{"valid empty address2", with(func(s *models.ShippingInfo) { s.Address2 = "" }), "", true},
		{"valid phone with parens", with(func(s *models.ShippingInfo) { s.Phone = "+1 (415) 555-0123" }), "", true},
		{"nil shipping is allowed", nil, "", true},

		{"state lowercase rejected", with(func(s *models.ShippingInfo) { s.State = "ca" }),
			"shipping.state must be a 2-letter uppercase US state code (e.g. CA)", false},
		{"state too long rejected", with(func(s *models.ShippingInfo) { s.State = "CAL" }),
			"shipping.state must be a 2-letter uppercase US state code (e.g. CA)", false},
		{"state empty rejected", with(func(s *models.ShippingInfo) { s.State = "" }),
			"shipping.state must be a 2-letter uppercase US state code (e.g. CA)", false},
		{"zip 4 digits rejected", with(func(s *models.ShippingInfo) { s.Zip = "9410" }),
			"shipping.zip must be a 5-digit US ZIP code (or ZIP+4, e.g. 12345-6789)", false},
		{"zip with letter rejected", with(func(s *models.ShippingInfo) { s.Zip = "9410A" }),
			"shipping.zip must be a 5-digit US ZIP code (or ZIP+4, e.g. 12345-6789)", false},
		{"zip+4 malformed rejected", with(func(s *models.ShippingInfo) { s.Zip = "94105-12" }),
			"shipping.zip must be a 5-digit US ZIP code (or ZIP+4, e.g. 12345-6789)", false},
		{"name required", with(func(s *models.ShippingInfo) { s.Name = "  " }),
			"shipping.name is required", false},
		{"name too long", with(func(s *models.ShippingInfo) { s.Name = long }),
			"shipping.name must be at most 120 characters", false},
		{"phone required", with(func(s *models.ShippingInfo) { s.Phone = "" }),
			"shipping.phone is required", false},
		{"phone too short", with(func(s *models.ShippingInfo) { s.Phone = "55512" }),
			"shipping.phone must be 7-40 characters", false},
		{"phone bad charset", with(func(s *models.ShippingInfo) { s.Phone = "555-ABC-1234" }),
			"shipping.phone may only contain digits, +, -, parentheses and spaces", false},
		{"address1 too short", with(func(s *models.ShippingInfo) { s.Address1 = "ab" }),
			"shipping.address1 must be 3-200 characters", false},
		{"address1 required", with(func(s *models.ShippingInfo) { s.Address1 = "" }),
			"shipping.address1 is required", false},
		{"address2 too long", with(func(s *models.ShippingInfo) { s.Address2 = long }),
			"shipping.address2 must be at most 200 characters", false},
		{"city required", with(func(s *models.ShippingInfo) { s.City = "" }),
			"shipping.city is required", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := validateShipping(tc.ship)
			if got != tc.want {
				t.Fatalf("validateShipping() = %q, want %q", got, tc.want)
			}
			if (got == "") != tc.valid {
				t.Fatalf("validity mismatch: got=%q valid=%v wantValid=%v", got, got == "", tc.valid)
			}
		})
	}
}

// TestNormaliseShippingTrims — 저장 전 공백 제거, nil은 nil 유지(하위 호환).
func TestNormaliseShippingTrims(t *testing.T) {
	if got := normaliseShipping(nil); got != nil {
		t.Errorf("normaliseShipping(nil) = %+v, want nil", got)
	}
	got := normaliseShipping(&models.ShippingInfo{
		Name: "  Alice Kim  ", Phone: " 415-555-0123 ", Address1: " 1 Market St, Apt 5 ",
		Address2: " Unit 5 ", City: " San Francisco ", State: " CA ", Zip: " 94105 ",
	})
	want := validShipping()
	if *got != want {
		t.Errorf("normaliseShipping() = %+v, want %+v", *got, want)
	}
	if msg := validateShipping(got); msg != "" {
		t.Errorf("normalised address should validate, got %q", msg)
	}
}

// TestCreateOrderWithShippingPersistsAddress — 배송지가 INSERT 인자로 전달되고
// 주문 생성은 성공(201)해야 한다.
func TestCreateOrderWithShippingPersistsAddress(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("BLOCKCHAIN_GATEWAY_URL", "") // 게이트웨이 미기동 → pending 유지

	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	now := time.Date(2026, 9, 28, 12, 0, 0, 0, time.UTC)
	ship := validShipping()
	amount := krwToUsdcMicro(13500)

	mock.ExpectBegin()
	mock.ExpectQuery(`
		UPDATE products SET stock = stock - $1, updated_at = NOW()
		WHERE id = $2 AND status = 'listed' AND stock >= $1
		RETURNING title, COALESCE(sale_price_krw, 0)
	`).WithArgs(1, 1).WillReturnRows(
		sqlmock.NewRows([]string{"title", "sale_price_krw"}).AddRow("Widget", 13500))

	mock.ExpectQuery(`
		INSERT INTO orders (user_id, wallet_address, status, total_krw, total_usdc_micro,
		                    ship_name, ship_phone, ship_address1, ship_address2, ship_city, ship_state, ship_zip)
		VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, user_id, wallet_address, status, total_krw, total_usdc_micro,
		          COALESCE(gateway_order_id, ''), COALESCE(tx_hash, ''), created_at, updated_at,
		          ship_name, ship_phone, ship_address1, ship_address2, ship_city, ship_state, ship_zip
	`).WithArgs(7, "0xbuyer", 13500, int64(amount),
		ship.Name, ship.Phone, ship.Address1, ship.Address2, ship.City, ship.State, ship.Zip,
	).WillReturnRows(orderRowsWithShipping(50, 7, "0xbuyer", 13500, amount, &ship, now))

	mock.ExpectExec(`
		INSERT INTO order_items (order_id, product_id, title, price_krw, qty)
		VALUES ($1, $2, $3, $4, $5)
	`).WithArgs(50, 1, "Widget", 13500, 1).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	router := gin.New()
	router.POST("/api/orders", func(c *gin.Context) {
		c.Set("userId", 7)
		c.Set("walletAddress", "0xbuyer")
		c.Next()
	}, CreateOrder(db))

	req := httptest.NewRequest(http.MethodPost, "/api/orders", createOrderBody(t, &ship))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
	t.Log("OK: shipping address persisted into ship_* columns on order INSERT")
}

// TestCreateOrderWithoutShippingIsBackwardCompatible — shipping 키가 없거나 null이면
// ship_* 는 모두 NULL로 저장되고 주문은 정상 생성된다 (기존 동작 유지).
func TestCreateOrderWithoutShippingIsBackwardCompatible(t *testing.T) {
	bodies := map[string]string{
		"absent": `{"items":[{"productId":1,"qty":1}]}`,
		"null":   `{"items":[{"productId":1,"qty":1}],"shipping":null}`,
	}

	for name, body := range bodies {
		t.Run(name, func(t *testing.T) {
			gin.SetMode(gin.TestMode)
			t.Setenv("BLOCKCHAIN_GATEWAY_URL", "")

			db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
			if err != nil {
				t.Fatalf("sqlmock: %v", err)
			}
			defer db.Close()

			now := time.Date(2026, 9, 28, 12, 0, 0, 0, time.UTC)
			amount := krwToUsdcMicro(13500)

			mock.ExpectBegin()
			mock.ExpectQuery(`
				UPDATE products SET stock = stock - $1, updated_at = NOW()
				WHERE id = $2 AND status = 'listed' AND stock >= $1
				RETURNING title, COALESCE(sale_price_krw, 0)
			`).WithArgs(1, 1).WillReturnRows(
				sqlmock.NewRows([]string{"title", "sale_price_krw"}).AddRow("Widget", 13500))

			mock.ExpectQuery(`
				INSERT INTO orders (user_id, wallet_address, status, total_krw, total_usdc_micro,
				                    ship_name, ship_phone, ship_address1, ship_address2, ship_city, ship_state, ship_zip)
				VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9, $10, $11)
				RETURNING id, user_id, wallet_address, status, total_krw, total_usdc_micro,
				          COALESCE(gateway_order_id, ''), COALESCE(tx_hash, ''), created_at, updated_at,
				          ship_name, ship_phone, ship_address1, ship_address2, ship_city, ship_state, ship_zip
			`).WithArgs(7, "0xbuyer", 13500, int64(amount),
				nil, nil, nil, nil, nil, nil, nil,
			).WillReturnRows(orderInsertRows(51, 7, "0xbuyer", 13500, amount, now))

			mock.ExpectExec(`
				INSERT INTO order_items (order_id, product_id, title, price_krw, qty)
				VALUES ($1, $2, $3, $4, $5)
			`).WithArgs(51, 1, "Widget", 13500, 1).WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectCommit()

			router := gin.New()
			router.POST("/api/orders", func(c *gin.Context) {
				c.Set("userId", 7)
				c.Set("walletAddress", "0xbuyer")
				c.Next()
			}, CreateOrder(db))

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
			t.Logf("OK: order without shipping (%s) → ship_* NULL, 201", name)
		})
	}
}

// TestCreateOrderInvalidShippingRejected — 잘못된 배송지는 DB를 건드리기 전에
// 400 + 영어 메시지로 거부된다 (주문/재고 변화 없음).
func TestCreateOrderInvalidShippingRejected(t *testing.T) {
	cases := []struct {
		name string
		ship models.ShippingInfo
		want string
	}{
		{"state lowercase", func() models.ShippingInfo { s := validShipping(); s.State = "ca"; return s }(),
			"shipping.state must be a 2-letter uppercase US state code (e.g. CA)"},
		{"zip 4 digits", func() models.ShippingInfo { s := validShipping(); s.Zip = "9410"; return s }(),
			"shipping.zip must be a 5-digit US ZIP code (or ZIP+4, e.g. 12345-6789)"},
		{"name empty", func() models.ShippingInfo { s := validShipping(); s.Name = " "; return s }(),
			"shipping.name is required"},
		{"phone too short", func() models.ShippingInfo { s := validShipping(); s.Phone = "555"; return s }(),
			"shipping.phone must be 7-40 characters"},
		{"city empty", func() models.ShippingInfo { s := validShipping(); s.City = ""; return s }(),
			"shipping.city is required"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gin.SetMode(gin.TestMode)

			db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
			if err != nil {
				t.Fatalf("sqlmock: %v", err)
			}
			defer db.Close()

			router := gin.New()
			router.POST("/api/orders", func(c *gin.Context) {
				c.Set("userId", 7)
				c.Set("walletAddress", "0xbuyer")
				c.Next()
			}, CreateOrder(db))

			ship := tc.ship
			req := httptest.NewRequest(http.MethodPost, "/api/orders", createOrderBody(t, &ship))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if w.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", w.Code, w.Body.String())
			}
			var resp struct {
				Error string `json:"error"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
				t.Fatalf("unmarshal: %v; body=%s", err, w.Body.String())
			}
			if resp.Error != tc.want {
				t.Errorf("error = %q, want %q", resp.Error, tc.want)
			}
			// 검증 실패 시 DB/재고에 손대지 않아야 한다 (기대 없음 = 호출 발생 시 실패)
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unmet sqlmock expectations: %v", err)
			}
			t.Logf("OK: rejected with 400 — %s", resp.Error)
		})
	}
}

// TestGetOrderReturnsShipping — 저장된 ship_* 값이 응답 order.shipping 으로 채워진다.
func TestGetOrderReturnsShipping(t *testing.T) {
	gin.SetMode(gin.TestMode)

	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	now := time.Date(2026, 9, 28, 12, 0, 0, 0, time.UTC)
	ship := validShipping()

	mock.ExpectQuery(shippingSelectSQL).WithArgs(5).WillReturnRows(
		orderRowsWithShipping(5, 7, "0xbuyer", 13500, krwToUsdcMicro(13500), &ship, now))
	mock.ExpectQuery(shippingItemsSQL).WithArgs(5).WillReturnRows(
		sqlmock.NewRows([]string{"id", "order_id", "product_id", "title", "price_krw", "qty"}).
			AddRow(1, 5, 1, "Widget", 13500, 1))

	router := gin.New()
	router.GET("/api/orders/:id", func(c *gin.Context) {
		c.Set("userId", 7)
		c.Next()
	}, GetOrder(db))

	req := httptest.NewRequest(http.MethodGet, "/api/orders/5", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}

	var resp struct {
		Order models.Order `json:"order"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v; body=%s", err, w.Body.String())
	}
	if resp.Order.Shipping == nil {
		t.Fatalf("order.shipping = nil, want populated; body=%s", w.Body.String())
	}
	if *resp.Order.Shipping != ship {
		t.Errorf("order.shipping = %+v, want %+v", *resp.Order.Shipping, ship)
	}

	// 응답 JSON 필드명 계약 (name, phone, address1, address2, city, state, zip)
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(w.Body.Bytes(), &raw); err != nil {
		t.Fatalf("unmarshal raw: %v", err)
	}
	var orderRaw map[string]json.RawMessage
	if err := json.Unmarshal(raw["order"], &orderRaw); err != nil {
		t.Fatalf("unmarshal order: %v", err)
	}
	shipRaw, present := orderRaw["shipping"]
	if !present {
		t.Fatalf(`order JSON must contain "shipping"; body=%s`, w.Body.String())
	}
	var fields map[string]string
	if err := json.Unmarshal(shipRaw, &fields); err != nil {
		t.Fatalf("unmarshal shipping: %v", err)
	}
	wantFields := map[string]string{
		"name": ship.Name, "phone": ship.Phone, "address1": ship.Address1,
		"address2": ship.Address2, "city": ship.City, "state": ship.State, "zip": ship.Zip,
	}
	if len(fields) != len(wantFields) {
		t.Errorf("shipping JSON keys = %v, want exactly %d keys", fields, len(wantFields))
	}
	for k, v := range wantFields {
		if fields[k] != v {
			t.Errorf("shipping.%s = %q, want %q", k, fields[k], v)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
	t.Log("OK: GET /api/orders/:id returns the stored shipping address")
}

// TestGetOrderLegacyOrderOmitsShipping — ship_* 가 NULL인 과거 주문은
// order.shipping 자체가 응답에 없어야 한다 (하위 호환).
func TestGetOrderLegacyOrderOmitsShipping(t *testing.T) {
	gin.SetMode(gin.TestMode)

	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	now := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	mock.ExpectQuery(shippingSelectSQL).WithArgs(5).WillReturnRows(
		orderSelectRows(models.Order{
			ID: 5, UserID: 7, WalletAddress: "0xbuyer", Status: "paid",
			TotalKRW: 13500, TotalUsdcMicro: krwToUsdcMicro(13500)},
			now))
	mock.ExpectQuery(shippingItemsSQL).WithArgs(5).WillReturnRows(
		sqlmock.NewRows([]string{"id", "order_id", "product_id", "title", "price_krw", "qty"}))

	router := gin.New()
	router.GET("/api/orders/:id", func(c *gin.Context) {
		c.Set("userId", 7)
		c.Next()
	}, GetOrder(db))

	req := httptest.NewRequest(http.MethodGet, "/api/orders/5", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}

	var resp struct {
		Order models.Order `json:"order"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v; body=%s", err, w.Body.String())
	}
	if resp.Order.Shipping != nil {
		t.Errorf("order.shipping = %+v, want nil for legacy order", *resp.Order.Shipping)
	}

	// JSON에도 shipping 키가 없어야 함 (omitempty)
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(w.Body.Bytes(), &raw); err != nil {
		t.Fatalf("unmarshal raw: %v", err)
	}
	var orderRaw map[string]json.RawMessage
	if err := json.Unmarshal(raw["order"], &orderRaw); err != nil {
		t.Fatalf("unmarshal order: %v", err)
	}
	if _, present := orderRaw["shipping"]; present {
		t.Errorf(`legacy order JSON must omit "shipping"; body=%s`, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
	t.Log("OK: legacy order (NULL ship_*) → order.shipping omitted")
}
