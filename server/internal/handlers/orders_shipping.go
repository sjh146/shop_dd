package handlers

import (
	"database/sql"
	"regexp"
	"strings"
	"unicode/utf8"

	"shop-dd/internal/models"
)

// ── 미국 배송지 (shipping address) ─────────────────────────────────────────
// 미국 고객이 결제 전에 입력하는 배송지. 운영자가 이 주소로 실제 구매·배송한다.
// 선택 필드이므로 값이 없으면(NULL) 기존과 완전히 동일하게 동작한다.
// DB: orders.ship_name/ship_phone/ship_address1/ship_address2/ship_city/
//     ship_state/ship_zip (모두 nullable) — NULL이면 응답 Order.Shipping=nil.

var (
	// phone — 숫자, +, -, 괄호, 공백만 허용
	shippingPhoneRe = regexp.MustCompile(`^[0-9+\-() ]+$`)
	// state — 정확히 2글자 대문자 영문 (미국 주/준주 코드)
	shippingStateRe = regexp.MustCompile(`^[A-Z]{2}$`)
	// zip — 5자리 또는 ZIP+4 (12345-6789)
	shippingZipRe = regexp.MustCompile(`^[0-9]{5}(-[0-9]{4})?$`)
)

// orderSelectColumns — orders 테이블 조회 시 사용하는 컬럼 목록(기본 10 + ship_* 7).
// INSERT ... RETURNING 및 모든 SELECT가 이 목록을 그대로 사용해야 하며,
// 목록이 어긋나면 database/sql Scan이 실패한다.
const orderSelectColumns = `id, user_id, wallet_address, status, total_krw, total_usdc_micro,
	COALESCE(gateway_order_id, ''), COALESCE(tx_hash, ''), created_at, updated_at,
	ship_name, ship_phone, ship_address1, ship_address2, ship_city, ship_state, ship_zip`

// normaliseShipping — 앞뒤 공백 제거. 입력이 nil이면 nil (하위 호환).
func normaliseShipping(s *models.ShippingInfo) *models.ShippingInfo {
	if s == nil {
		return nil
	}
	return &models.ShippingInfo{
		Name:     strings.TrimSpace(s.Name),
		Phone:    strings.TrimSpace(s.Phone),
		Address1: strings.TrimSpace(s.Address1),
		Address2: strings.TrimSpace(s.Address2),
		City:     strings.TrimSpace(s.City),
		State:    strings.TrimSpace(s.State),
		Zip:      strings.TrimSpace(s.Zip),
	}
}

// validateShipping — 서버 측 배송지 검증. 위반 시 영어 메시지, 통과 시 "".
// 앞뒤 공백은 무시하고 판정한다(핸들러는 normaliseShipping으로 정규화 후 저장).
//
//	name      1-120자 필수
//	phone     7-40자 필수, 숫자/+/ -/(/)/공백만 허용
//	address1  3-200자 필수
//	address2  0-200자 선택
//	city      1-120자 필수
//	state     정확히 2글자 대문자 미국 주/준주 코드
//	zip       5자리 또는 ZIP+4 (12345-6789)
func validateShipping(s *models.ShippingInfo) string {
	if s == nil {
		return ""
	}
	name := strings.TrimSpace(s.Name)
	phone := strings.TrimSpace(s.Phone)
	address1 := strings.TrimSpace(s.Address1)
	address2 := strings.TrimSpace(s.Address2)
	city := strings.TrimSpace(s.City)
	state := strings.TrimSpace(s.State)
	zip := strings.TrimSpace(s.Zip)

	switch n := utf8.RuneCountInString(name); {
	case n == 0:
		return "shipping.name is required"
	case n > 120:
		return "shipping.name must be at most 120 characters"
	}

	switch n := utf8.RuneCountInString(phone); {
	case n == 0:
		return "shipping.phone is required"
	case n < 7 || n > 40:
		return "shipping.phone must be 7-40 characters"
	case !shippingPhoneRe.MatchString(phone):
		return "shipping.phone may only contain digits, +, -, parentheses and spaces"
	}

	switch n := utf8.RuneCountInString(address1); {
	case n == 0:
		return "shipping.address1 is required"
	case n < 3 || n > 200:
		return "shipping.address1 must be 3-200 characters"
	}

	if utf8.RuneCountInString(address2) > 200 {
		return "shipping.address2 must be at most 200 characters"
	}

	switch n := utf8.RuneCountInString(city); {
	case n == 0:
		return "shipping.city is required"
	case n > 120:
		return "shipping.city must be at most 120 characters"
	}

	if !shippingStateRe.MatchString(state) {
		return "shipping.state must be a 2-letter uppercase US state code (e.g. CA)"
	}
	if !shippingZipRe.MatchString(zip) {
		return "shipping.zip must be a 5-digit US ZIP code (or ZIP+4, e.g. 12345-6789)"
	}
	return ""
}

// shippingArgs — orders INSERT용 ship_* 인자 7개. 빈 값은 NULL.
func shippingArgs(s *models.ShippingInfo) []interface{} {
	if s == nil {
		return []interface{}{nil, nil, nil, nil, nil, nil, nil}
	}
	return []interface{}{
		shipNull(s.Name), shipNull(s.Phone), shipNull(s.Address1), shipNull(s.Address2),
		shipNull(s.City), shipNull(s.State), shipNull(s.Zip),
	}
}

func shipNull(v string) interface{} {
	if v == "" {
		return nil
	}
	return v
}

// shippingScan — ship_* 컬럼 스캔 대상 (NULL 허용).
type shippingScan struct {
	name, phone, address1, address2, city, state, zip sql.NullString
}

func (s *shippingScan) targets() []interface{} {
	return []interface{}{&s.name, &s.phone, &s.address1, &s.address2, &s.city, &s.state, &s.zip}
}

// apply — 스캔 결과를 Order.Shipping으로 옮긴다. 전부 NULL이면 마이그레이션
// 이전 주문이므로 Shipping=nil 유지 (JSON에서 생략).
func (s *shippingScan) apply(o *models.Order) {
	if !s.name.Valid && !s.phone.Valid && !s.address1.Valid && !s.address2.Valid &&
		!s.city.Valid && !s.state.Valid && !s.zip.Valid {
		return
	}
	o.Shipping = &models.ShippingInfo{
		Name:     s.name.String,
		Phone:    s.phone.String,
		Address1: s.address1.String,
		Address2: s.address2.String,
		City:     s.city.String,
		State:    s.state.String,
		Zip:      s.zip.String,
	}
}

// orderRowScanner — *sql.Row / *sql.Rows 공용 인터페이스.
type orderRowScanner interface {
	Scan(dest ...interface{}) error
}

// scanOrderInto — orders 행(orderSelectColumns 순서: 기본 10 + ship_* 7)을
// Order로 스캔하고 Shipping을 채운다. 모든 조회 경로가 이 함수를 써서
// 컬럼 순서 불일치로 인한 Scan 에러를 막는다.
func scanOrderInto(row orderRowScanner, o *models.Order) error {
	ship := &shippingScan{}
	dest := []interface{}{
		&o.ID, &o.UserID, &o.WalletAddress, &o.Status, &o.TotalKRW, &o.TotalUsdcMicro,
		&o.GatewayOrderID, &o.TxHash, &o.CreatedAt, &o.UpdatedAt,
	}
	dest = append(dest, ship.targets()...)
	if err := row.Scan(dest...); err != nil {
		return err
	}
	ship.apply(o)
	return nil
}
