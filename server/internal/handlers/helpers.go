package handlers

import (
	"errors"
	"fmt"
	"math"
	"os"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// ── 공용 헬퍼 ─────────────────────────────────────────────────────────────

var errInvalidSignature = errors.New("invalid signature")

func sprintf(format string, args ...interface{}) string {
	return fmt.Sprintf(format, args...)
}

func envInt(name string, fallback int) int {
	v := os.Getenv(name)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}

func envBool(name string, fallback bool) bool {
	v := os.Getenv(name)
	if v == "" {
		return fallback
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return fallback
	}
	return b
}

// jwtSecret — JWT 시크릿. env 필수 (하드코딩 폴백 제거 — CWE-287, fail-closed).
func jwtSecret() []byte {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		panic("JWT_SECRET is required (fail-closed)")
	}
	return []byte(secret)
}

// jwtRegisteredClaims — issuer는 shop_dd (cmall_dd 아님).
func jwtRegisteredClaims() jwt.RegisteredClaims {
	expirationTime := time.Now().Add(24 * 7 * time.Hour) // 7 days
	return jwt.RegisteredClaims{
		ExpiresAt: jwt.NewNumericDate(expirationTime),
		IssuedAt:  jwt.NewNumericDate(time.Now()),
		Issuer:    "shop_dd",
	}
}

func signClaims(claims *Claims) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret())
}

func hashPassword(password string) (string, error) {
	hashed, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(hashed), err
}

// internalKey — 내부 API 키 (blockchain-gateway 호출용).
func internalKey(name string) string {
	return os.Getenv(name)
}

// ── KRW → USDC 변환 ───────────────────────────────────────────────────────
// micro = round(total_krw / 1350.0) * 1_000_000
func krwToUsdcMicro(totalKRW int) int64 {
	usdc := math.Round(float64(totalKRW)/1350.0) * 1_000_000
	return int64(usdc)
}
