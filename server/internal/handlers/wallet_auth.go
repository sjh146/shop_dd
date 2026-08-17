package handlers

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"shop-dd/internal/models"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/gin-gonic/gin"
)

// ── 지갑 인증 ─────────────────────────────────────────────────────────────
// 시크릿 무영속 원칙: 서버는 nonce/서명 검증 결과만 저장한다.
// 개인키/시드는 절대 서버에 존재하지 않는다.

const (
	nonceTTL        = 5 * time.Minute
	loginMessageFmt = "shop_dd login (chain %d)\nnonce: %s"
)

// personalSignHash — EIP-191 개인 서명 메시지 해시
func personalSignHash(message []byte) []byte {
	lenStr := itoa(len(message))
	prefixed := append([]byte("\x19Ethereum Signed Message:\n"), []byte(lenStr)...)
	return crypto.Keccak256(append(prefixed, message...))
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}

// randomHex — 암호학적 난수 hex 문자열
func randomHex(nBytes int) (string, error) {
	b := make([]byte, nBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// Register — POST /api/auth/register
// 일반 이메일 가입. @wallet.local 예약 도메인은 스쿼팅 방지로 400 거부 (cmall hardening).
func Register(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Email    string `json:"email" binding:"required,email"`
			Password string `json:"password" binding:"required,min=8"`
			Name     string `json:"name" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		// @wallet.local 예약 도메인 스쿼팅 방지 (지갑 전용 계정과 충돌 불가)
		if strings.HasSuffix(strings.ToLower(req.Email), "@wallet.local") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "reserved domain @wallet.local cannot be registered"})
			return
		}

		hashed, err := hashPassword(req.Password)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
			return
		}

		var user models.User
		err = db.QueryRow(`
			INSERT INTO users (email, password, name, role, is_wallet_user)
			VALUES ($1, $2, $3, 'buyer', false)
			RETURNING id, email, name, role, is_wallet_user, created_at, updated_at
		`, strings.ToLower(req.Email), hashed, req.Name).Scan(
			&user.ID, &user.Email, &user.Name, &user.Role, &user.IsWalletUser,
			&user.CreatedAt, &user.UpdatedAt,
		)
		if err != nil {
			c.JSON(http.StatusConflict, gin.H{"error": "email already registered"})
			return
		}

		c.JSON(http.StatusCreated, gin.H{"id": user.ID, "email": user.Email, "name": user.Name})
	}
}

// WalletNonce — POST /api/auth/nonce
// 지갑 주소에 대한 로그인 nonce 발급 (TTL 5분, single-use)
func WalletNonce(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req models.NonceRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		wallet := strings.ToLower(req.WalletAddress)
		if !common.IsHexAddress(wallet) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid wallet address"})
			return
		}

		nonce, err := randomHex(32)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate nonce"})
			return
		}

		chainID := envInt("CHAIN_ID", 84532)
		_, err = db.Exec(
			"INSERT INTO auth_challenges (wallet_address, nonce, challenge_type, expires_at) VALUES ($1, $2, 'wallet', $3)",
			wallet, nonce, time.Now().Add(nonceTTL),
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save challenge"})
			return
		}

		c.JSON(http.StatusOK, models.NonceResponse{
			Nonce:     nonce,
			Message:   sprintf(loginMessageFmt, chainID, nonce),
			ExpiresIn: int(nonceTTL.Seconds()),
		})
	}
}

// WalletVerify — POST /api/auth/verify
// nonce 서명 검증 → 지갑 등록 → JWT 발급 (walletAddress claim 포함)
func WalletVerify(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req models.VerifyRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		wallet := strings.ToLower(req.WalletAddress)
		if !common.IsHexAddress(wallet) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid wallet address"})
			return
		}

		// ① 원자적 nonce consume (single-use — 리플레이 차단)
		var challengeWallet string
		var challengeType string
		err := db.QueryRow(`
			UPDATE auth_challenges
			SET used_at = NOW()
			WHERE nonce = $1 AND used_at IS NULL AND expires_at > NOW()
			RETURNING wallet_address, challenge_type
		`, req.Nonce).Scan(&challengeWallet, &challengeType)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired nonce"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to consume nonce"})
			return
		}
		if !strings.EqualFold(challengeWallet, wallet) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "nonce issued for a different wallet"})
			return
		}

		// ② 서명 검증 — 항상 실제 EIP-191 개인 서명 검증 (dev 우회 경로 없음, CWE-287)
		chainID := envInt("CHAIN_ID", 84532)
		msg := []byte(sprintf(loginMessageFmt, chainID, req.Nonce))
		recovered, err := recoverAddress(msg, req.Signature)
		if err != nil || !strings.EqualFold(recovered, wallet) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid signature"})
			return
		}

		// ③ 사용자 조회/생성 (지갑 전용 계정 프로비저닝)
		user, err := getOrCreateWalletUser(db, wallet)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to provision user"})
			return
		}

		// ④ JWT 발급
		token, err := generateWalletToken(user, wallet)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
			return
		}

		c.JSON(http.StatusOK, models.WalletAuthResponse{
			Token:         token,
			WalletAddress: wallet,
			User:          user,
		})
	}
}

// ── 내부 헬퍼 ─────────────────────────────────────────────────────────────

// recoverAddress — EIP-191 personal_sign 서명에서 주소 복구
func recoverAddress(message []byte, signature string) (string, error) {
	sig := common.FromHex(signature)
	if len(sig) != 65 {
		return "", errInvalidSignature
	}
	// v 값 정규화 (27/28 → 0/1)
	if sig[64] >= 27 {
		sig[64] -= 27
	}
	hash := personalSignHash(message)
	pub, err := crypto.SigToPub(hash, sig)
	if err != nil {
		return "", err
	}
	return crypto.PubkeyToAddress(*pub).Hex(), nil
}

// getOrCreateWalletUser — 지갑 전용 사용자 자동 프로비저닝.
// email = <wallet>@wallet.local, 랜덤 bcrypt 비밀번호 (로그인 불가).
// ON CONFLICT(email) DO UPDATE — 레거시 지갑 계정 승격 (cmall 패턴).
func getOrCreateWalletUser(db *sql.DB, wallet string) (models.User, error) {
	var user models.User
	email := wallet + "@wallet.local"

	err := db.QueryRow(`
		SELECT id, email, name, role, is_wallet_user, created_at, updated_at
		FROM users WHERE email = $1 AND is_wallet_user = true
	`, email).Scan(&user.ID, &user.Email, &user.Name, &user.Role,
		&user.IsWalletUser, &user.CreatedAt, &user.UpdatedAt)
	if err == nil {
		return user, nil
	}
	if err != sql.ErrNoRows {
		return user, err
	}

	randPass, _ := randomHex(32)
	hashed, _ := hashPassword(randPass)
	err = db.QueryRow(`
		INSERT INTO users (email, password, name, role, is_wallet_user)
		VALUES ($1, $2, $3, 'buyer', true)
		ON CONFLICT (email) DO UPDATE
			SET password = EXCLUDED.password,
			    name = EXCLUDED.name,
			    is_wallet_user = true,
			    role = CASE WHEN users.role = 'admin' THEN 'admin' ELSE 'buyer' END,
			    updated_at = CURRENT_TIMESTAMP
		RETURNING id, email, name, role, is_wallet_user, created_at, updated_at
	`, email, hashed, "Wallet User").Scan(&user.ID, &user.Email, &user.Name, &user.Role,
		&user.IsWalletUser, &user.CreatedAt, &user.UpdatedAt)
	return user, err
}

// generateWalletToken — walletAddress claim 포함 JWT
func generateWalletToken(user models.User, wallet string) (string, error) {
	claims := &Claims{
		UserID:        user.ID,
		Email:         user.Email,
		Role:          user.Role,
		WalletAddress: wallet,
		RegisteredClaims: jwtRegisteredClaims(),
	}
	return signClaims(claims)
}
