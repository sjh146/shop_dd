package handlers

import (
	"database/sql"
	"net/http"
	"strings"

	"shop-dd/internal/models"
	"github.com/gin-gonic/gin"
)

// ── 이메일/비밀번호 인증 ──────────────────────────────────────────────────
// 회원가입은 Register (wallet_auth.go). 여기는 로그인과 현재 사용자 조회.

// SQL은 테스트(sqlmock QueryMatcherEqual)가 같은 상수를 참조한다 — 리터럴 중복 금지.
const (
	selectUserByEmailSQL = `SELECT id, email, password, name, role, is_wallet_user, created_at, updated_at FROM users WHERE email = $1`
	selectUserByIDSQL    = `SELECT id, email, name, role, is_wallet_user, created_at, updated_at FROM users WHERE id = $1`
)

// Login — POST /api/auth/login
// 이메일/비밀번호 검증 후 JWT 발급. 실패 사유를 구분하지 않는다 (계정 열거 방지).
func Login(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req models.LoginRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		email := strings.ToLower(strings.TrimSpace(req.Email))

		var user models.User
		err := db.QueryRow(selectUserByEmailSQL, email).Scan(
			&user.ID, &user.Email, &user.Password, &user.Name, &user.Role,
			&user.IsWalletUser, &user.CreatedAt, &user.UpdatedAt,
		)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
			return
		}
		if err != nil {
			respondDBError(c, err)
			return
		}

		// 지갑 전용 계정 차단 + bcrypt 비교 실패 시에도 동일 응답 (계정 열거 방지)
		if user.IsWalletUser || checkPassword(user.Password, req.Password) != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
			return
		}

		token, err := signClaims(&Claims{
			UserID:           user.ID,
			Email:            user.Email,
			Role:             user.Role,
			RegisteredClaims: jwtRegisteredClaims(),
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
			return
		}

		c.JSON(http.StatusOK, models.LoginResponse{Token: token, User: user})
	}
}

// Me — GET /api/auth/me (JWT 필수)
// 현재 로그인한 사용자 정보를 반환한다 (프론트의 세션 복원용).
func Me(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, exists := c.Get("userId")
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			return
		}

		var user models.User
		err := db.QueryRow(selectUserByIDSQL, userID).Scan(
			&user.ID, &user.Email, &user.Name, &user.Role,
			&user.IsWalletUser, &user.CreatedAt, &user.UpdatedAt,
		)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
			return
		}
		if err != nil {
			respondDBError(c, err)
			return
		}

		c.JSON(http.StatusOK, models.MeResponse{User: user})
	}
}
