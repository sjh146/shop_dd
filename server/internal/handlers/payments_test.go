package handlers

import (
	"testing"

	"shop-dd/internal/models"
)

// TestPaymentMatchesGateway verifies the on-chain amount/payer matching logic
// against a recorded order.
func TestPaymentMatchesGateway(t *testing.T) {
	order := &models.Order{
		TotalUsdcMicro: 2_500_000,
		WalletAddress:  "0xabc...",
	}

	cases := []struct {
		name     string
		gateway  map[string]interface{}
		expected bool
	}{
		{
			name:     "matching amount and payer (uppercase payer)",
			gateway:  map[string]interface{}{"amount_usdc": "2500000", "payer": "0xAbC..."},
			expected: true,
		},
		{
			name:     "amount mismatch",
			gateway:  map[string]interface{}{"amount_usdc": "2500001", "payer": "0xabc..."},
			expected: false,
		},
		{
			name:     "payer mismatch",
			gateway:  map[string]interface{}{"amount_usdc": "2500000", "payer": "0xdef..."},
			expected: false,
		},
		{
			name:     "missing payer",
			gateway:  map[string]interface{}{"amount_usdc": "2500000"},
			expected: false,
		},
		{
			name:     "missing amount",
			gateway:  map[string]interface{}{"payer": "0xabc..."},
			expected: false,
		},
		{
			name:     "amount as float64",
			gateway:  map[string]interface{}{"amount_usdc": 2500000.0, "payer": "0xabc..."},
			expected: true,
		},
		{
			name:     "amount as non-numeric string",
			gateway:  map[string]interface{}{"amount_usdc": "not-a-number", "payer": "0xabc..."},
			expected: false,
		},
		{
			name:     "amount as wrong type",
			gateway:  map[string]interface{}{"amount_usdc": true, "payer": "0xabc..."},
			expected: false,
		},
		{
			name:     "payer with surrounding whitespace",
			gateway:  map[string]interface{}{"amount_usdc": "2500000", "payer": "  0xabc...  "},
			expected: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := paymentMatchesGateway(tc.gateway, order)
			if got != tc.expected {
				t.Errorf("paymentMatchesGateway(%v) = %v, want %v", tc.gateway, got, tc.expected)
			}
		})
	}
}
