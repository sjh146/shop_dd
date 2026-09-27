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

// checkPassword — bcrypt 해시와 평문 비밀번호 비교 (일치하면 nil).
func checkPassword(hash, password string) error {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
}

// internalKey — 내부 API 키 (blockchain-gateway 호출용).
func internalKey(name string) string {
	return os.Getenv(name)
}

// ── KRW → USDC 변환 ───────────────────────────────────────────────────────
// 1 USDC = 1_000_000 micro (6 decimals). 청구 정밀도는 센트(0.01 USDC = 10_000 micro)까지
// 보존한다 — 1 USDC 단위로 반올림하면 5900원($4.37어치)을 4 USDC로 받는 손실이 생긴다.
//
//	cents = round(total_krw / 1350.0 * 100)
//	micro = cents * 10_000
//
// 예: 5900 → 4.37 USDC → 4_370_000 micro, 675 → 0.50 USDC → 500_000 micro.
func krwToUsdcMicro(totalKRW int) int64 {
	cents := math.Round(float64(totalKRW) / 1350.0 * 100)
	return int64(cents) * 10_000
}
