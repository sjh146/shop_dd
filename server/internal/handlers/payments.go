package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"shop-dd/internal/models"
)

// ── 결제 게이트웨이 클라이언트 ─────────────────────────────────────────────
// 흐름: CreateOrder → gateway register (사전등록) → 사용자가 지갑에서 USDC 결제
// (컨트랙트) → VerifyOrder가 blockchain-gateway 온체인 검증 호출 → status=paid.
// 시크릿 무영속: 서버는 결제 상태/참조 ID만 저장.

// gatewayURL — blockchain-gateway 베이스 URL
func gatewayURL() string {
	return os.Getenv("BLOCKCHAIN_GATEWAY_URL") // e.g. http://blockchain-gateway:8091
}

// verifyWithGateway — blockchain-gateway에 결제 검증 요청
// 반환: {verified, tx_hash, order_id, payer, amount_usdc, chain_id}
func verifyWithGateway(referenceID string) (map[string]interface{}, error) {
	base := gatewayURL()
	if base == "" {
		return nil, fmt.Errorf("BLOCKCHAIN_GATEWAY_URL not set")
	}
	body, _ := json.Marshal(map[string]string{"reference_id": referenceID})
	req, err := http.NewRequest(http.MethodPost, base+"/internal/blockchain/payment/verify", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Api-Key", internalKey("INTERNAL_API_KEY"))

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gateway returned %d: %s", resp.StatusCode, string(respBody))
	}
	var result map[string]interface{}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, err
	}
	return result, nil
}

// registerWithGateway — 결제 주문 사전등록.
// 성공 시 게이트웨이 응답(주문 정보 포함)을 반환해 order handler가
// gateway_order_id를 저장할 수 있게 한다. 실패 시 nil, err 반환 (no-downtime:
// 호출자는 pending 상태를 유지한다).
func registerWithGateway(referenceID, walletAddress string, amountUsdc int64) (map[string]interface{}, error) {
	base := gatewayURL()
	if base == "" {
		return nil, fmt.Errorf("BLOCKCHAIN_GATEWAY_URL not set")
	}
	body, _ := json.Marshal(map[string]interface{}{
		"reference_id":   referenceID,
		"wallet_address": walletAddress,
		"amount_usdc":    strconv.FormatInt(amountUsdc, 10),
	})
	req, err := http.NewRequest(http.MethodPost, base+"/internal/blockchain/payment/register", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Api-Key", internalKey("INTERNAL_API_KEY"))

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[payments] register failed (ref=%s): %v", referenceID, err)
		return nil, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode != http.StatusOK {
		log.Printf("[payments] register returned %d (ref=%s): %s", resp.StatusCode, referenceID, string(respBody))
		return nil, fmt.Errorf("gateway register returned %d", resp.StatusCode)
	}
	var result map[string]interface{}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, err
	}
	log.Printf("[payments] register OK (ref=%s, wallet=%s, amount=%d)", referenceID, walletAddress, amountUsdc)
	return result, nil
}

// paymentMatchesGateway — 게이트웨이가 반환한 온체인 금액/지갑이 주문 레코드와
// 일치하는지 검증. amount_usdc (마이크로 단위)가 order.TotalUsdcMicro와 동일하고,
// payer 지갑이 order.WalletAddress(소문자)와 동일할 때만 true를 반환한다.
func paymentMatchesGateway(gatewayResult map[string]interface{}, order *models.Order) bool {
	amountOk := false
	if amtStr, ok := gatewayResult["amount_usdc"].(string); ok {
		if amt, err := strconv.ParseInt(amtStr, 10, 64); err == nil {
			amountOk = amt == order.TotalUsdcMicro
		}
	} else if amtNum, ok := gatewayResult["amount_usdc"].(float64); ok {
		amountOk = int64(amtNum) == order.TotalUsdcMicro
	}
	if !amountOk {
		return false
	}

	payer, ok := gatewayResult["payer"].(string)
	if !ok {
		return false
	}
	return strings.ToLower(strings.TrimSpace(payer)) == order.WalletAddress
}
