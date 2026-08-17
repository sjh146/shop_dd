package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// TestAuthMiddlewareRejectsAlgNone empirically verifies whether the
// middleware (AuthMiddleware) accepts alg=none / weak-algorithm tokens when
// the keyfunc always returns the HMAC secret.
func TestAuthMiddlewareRejectsAlgNone(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("JWT_SECRET", "test-secret")

	router := gin.New()
	router.Use(AuthMiddleware())
	router.GET("/protected", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"userId": c.GetInt("userId")})
	})

	mkRequest := func(tokenStr string) *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/protected", nil)
		r.Header.Set("Authorization", "Bearer "+tokenStr)
		return r
	}

	// (1) alg=none token, unsigned.
	none := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.MapClaims{
		"userId": 1, "role": "buyer",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	noneStr, err := none.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("failed to craft alg=none token: %v", err)
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, mkRequest(noneStr))
	t.Logf("alg=none → status %d (want 401)", w.Code)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("alg=none token was accepted (status %d) — algorithm confusion present", w.Code)
	}

	// (2) HS384 token signed with the same secret — does middleware accept it?
	hs384 := jwt.NewWithClaims(jwt.SigningMethodHS384, jwt.MapClaims{
		"userId": 2, "role": "admin",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	hs384Str, err := hs384.SignedString([]byte("test-secret"))
	if err != nil {
		t.Fatalf("failed to sign HS384: %v", err)
	}
	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, mkRequest(hs384Str))
	t.Logf("HS384 with same secret → status %d", w2.Code)

	// (3) HS512 token signed with same secret.
	hs512 := jwt.NewWithClaims(jwt.SigningMethodHS512, jwt.MapClaims{
		"userId": 3, "role": "admin",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	hs512Str, _ := hs512.SignedString([]byte("test-secret"))
	w3 := httptest.NewRecorder()
	router.ServeHTTP(w3, mkRequest(hs512Str))
	t.Logf("HS512 with same secret → status %d", w3.Code)

}

// Tests directly at the parser level to see which methods ParseWithClaims accepts.
func TestParserAcceptableMethods(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")
	secret := jwtSecret()

	// alg=none
	none := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.MapClaims{"exp": time.Now().Add(time.Hour).Unix()})
	noneStr, err := none.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("craft alg=none: %v", err)
	}
	claims := &Claims{}
	_, err = jwt.ParseWithClaims(noneStr, claims, func(tok *jwt.Token) (interface{}, error) { return secret, nil })
	t.Logf("ParseWithClaims(alg=none) err=%v", err)
	if err == nil {
		t.Error("alg=none token parsed successfully — UNSAFE")
	} else {
		t.Logf("alg=none correctly rejected (%v)", err)
	}

	// HS384 with the same secret
	h384 := jwt.NewWithClaims(jwt.SigningMethodHS384, jwt.MapClaims{"role": "admin", "exp": time.Now().Add(time.Hour).Unix()})
	h384Str, err := h384.SignedString(secret)
	if err != nil {
		t.Fatalf("craft HS384: %v", err)
	}
	claims2 := &Claims{}
	tok2, err := jwt.ParseWithClaims(h384Str, claims2, func(tok *jwt.Token) (interface{}, error) { return secret, nil })
	t.Logf("ParseWithClaims(HS384) valid=%v err=%v role=%s", tok2 != nil && tok2.Valid, err, claims2.Role)
	if err == nil && tok2.Valid {
		t.Logf("NOTE: HS384 token accepted — with-hmac-family confusion is possible")
	}
}