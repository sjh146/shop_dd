package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

// ── 이메일/비밀번호 인증 핸들러 테스트 (sqlmock, QueryMatcherEqual) ──────
// 핸들러와 테스트가 같은 SQL 상수를 참조하므로 쿼리 문자열이 어긋날 수 없다.

func newAuthMockDB(t *testing.T) (*sql.DB, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("failed to create sqlmock: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db, mock
}

// authUserRows — selectUserByEmailSQL 스캔 순서(8열)와 일치하는 행.
func authUserRows(hash string, isWallet bool) *sqlmock.Rows {
	now := time.Date(2026, 9, 27, 12, 0, 0, 0, time.UTC)
	return sqlmock.NewRows([]string{
		"id", "email", "password", "name", "role", "is_wallet_user", "created_at", "updated_at",
	}).AddRow(7, "buyer@example.com", hash, "구매자", "buyer", isWallet, now, now)
}

func postJSON(r http.Handler, path, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	return w
}

func TestLoginSuccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("JWT_SECRET", "test-secret")
	db, mock := newAuthMockDB(t)

	hash, _ := bcrypt.GenerateFromPassword([]byte("correct-horse-battery"), bcrypt.DefaultCost)
	mock.ExpectQuery(selectUserByEmailSQL).
		WithArgs("buyer@example.com").
		WillReturnRows(authUserRows(string(hash), false))

	r := gin.New()
	r.POST("/api/auth/login", Login(db))
	w := postJSON(r, "/api/auth/login", `{"email":"Buyer@Example.com","password":"correct-horse-battery"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	var resp struct {
		Token string         `json:"token"`
		User  map[string]any `json:"user"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if resp.Token == "" {
		t.Error("token is empty")
	}
	if resp.User["email"] != "buyer@example.com" {
		t.Errorf("user.email = %v, want buyer@example.com", resp.User["email"])
	}
	// models.User.Password 는 json:"-" — 응답에 해시가 새어나가면 안 된다.
	if _, leaked := resp.User["password"]; leaked {
		t.Error("password leaked in response")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestLoginUnknownEmail(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("JWT_SECRET", "test-secret")
	db, mock := newAuthMockDB(t)

	mock.ExpectQuery(selectUserByEmailSQL).
		WithArgs("ghost@example.com").
		WillReturnRows(authUserRows("", false).RowError(0, sql.ErrNoRows))

	r := gin.New()
	r.POST("/api/auth/login", Login(db))
	w := postJSON(r, "/api/auth/login", `{"email":"ghost@example.com","password":"whatever-123"}`)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (body: %s)", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestLoginWrongPassword(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("JWT_SECRET", "test-secret")
	db, mock := newAuthMockDB(t)

	hash, _ := bcrypt.GenerateFromPassword([]byte("right-password-1"), bcrypt.DefaultCost)
	mock.ExpectQuery(selectUserByEmailSQL).
		WithArgs("buyer@example.com").
		WillReturnRows(authUserRows(string(hash), false))

	r := gin.New()
	r.POST("/api/auth/login", Login(db))
	w := postJSON(r, "/api/auth/login", `{"email":"buyer@example.com","password":"wrong-password-2"}`)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (body: %s)", w.Code, w.Body.String())
	}
}

// TestLoginWalletUserRejected — 비밀번호가 맞아도 지갑 전용 계정은 비밀번호 로그인 불가.
func TestLoginWalletUserRejected(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("JWT_SECRET", "test-secret")
	db, mock := newAuthMockDB(t)

	hash, _ := bcrypt.GenerateFromPassword([]byte("matching-password"), bcrypt.DefaultCost)
	mock.ExpectQuery(selectUserByEmailSQL).
		WithArgs("buyer@example.com").
		WillReturnRows(authUserRows(string(hash), true))

	r := gin.New()
	r.POST("/api/auth/login", Login(db))
	w := postJSON(r, "/api/auth/login", `{"email":"buyer@example.com","password":"matching-password"}`)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (body: %s)", w.Code, w.Body.String())
	}
}

func TestLoginInvalidEmailRejected(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("JWT_SECRET", "test-secret")
	db, mock := newAuthMockDB(t)

	// 바인딩 실패 → DB 호출 없이 400 (예상 쿼리 없음: 호출되면 sqlmock이 에러를 낸다)
	r := gin.New()
	r.POST("/api/auth/login", Login(db))
	w := postJSON(r, "/api/auth/login", `{"email":"not-an-email","password":"whatever-123"}`)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body: %s)", w.Code, w.Body.String())
	}
	_ = mock
}

func TestMeSuccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock := newAuthMockDB(t)

	now := time.Date(2026, 9, 27, 12, 0, 0, 0, time.UTC)
	mock.ExpectQuery(selectUserByIDSQL).
		WithArgs(7).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "email", "name", "role", "is_wallet_user", "created_at", "updated_at",
		}).AddRow(7, "buyer@example.com", "구매자", "buyer", false, now, now))

	r := gin.New()
	r.GET("/api/auth/me", func(c *gin.Context) { c.Set("userId", 7) }, Me(db))

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	var resp struct {
		User map[string]any `json:"user"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if resp.User["email"] != "buyer@example.com" {
		t.Errorf("user.email = %v", resp.User["email"])
	}
	if _, leaked := resp.User["password"]; leaked {
		t.Error("password leaked in response")
	}
}

func TestMeWithoutAuthContext(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, _ := newAuthMockDB(t)

	r := gin.New()
	r.GET("/api/auth/me", Me(db))

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

// TestRegisterRejectsWalletLocalDomain — @wallet.local 예약 도메인 스쿼팅 방지.
func TestRegisterRejectsWalletLocalDomain(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, _ := newAuthMockDB(t)

	r := gin.New()
	r.POST("/api/auth/register", Register(db))
	w := postJSON(r, "/api/auth/register", `{"email":"attacker@wallet.local","password":"password123","name":"공격자"}`)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body: %s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "reserved") {
		t.Errorf("error body = %s, want reserved-domain message", w.Body.String())
	}
}

func TestRegisterSuccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock := newAuthMockDB(t)

	now := time.Date(2026, 9, 27, 12, 0, 0, 0, time.UTC)
	mock.ExpectQuery(insertEmailUserSQL).
		WithArgs("newbie@example.com", sqlmock.AnyArg(), "뉴비").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "email", "name", "role", "is_wallet_user", "created_at", "updated_at",
		}).AddRow(9, "newbie@example.com", "뉴비", "buyer", false, now, now))

	r := gin.New()
	r.POST("/api/auth/register", Register(db))
	w := postJSON(r, "/api/auth/register", `{"email":"Newbie@Example.com","password":"password123","name":"뉴비"}`)

	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body: %s)", w.Code, w.Body.String())
	}
	var resp struct {
		ID    int    `json:"id"`
		Email string `json:"email"`
		Name  string `json:"name"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if resp.ID != 9 || resp.Email != "newbie@example.com" {
		t.Errorf("resp = %+v, want id=9 email=newbie@example.com", resp)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestRegisterDuplicateEmail(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, mock := newAuthMockDB(t)

	mock.ExpectQuery(insertEmailUserSQL).
		WithArgs("dup@example.com", sqlmock.AnyArg(), "중복").
		WillReturnError(errors.New("pq: duplicate key value violates unique constraint \"users_email_key\""))

	r := gin.New()
	r.POST("/api/auth/register", Register(db))
	w := postJSON(r, "/api/auth/register", `{"email":"dup@example.com","password":"password123","name":"중복"}`)

	if w.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 (body: %s)", w.Code, w.Body.String())
	}
}
