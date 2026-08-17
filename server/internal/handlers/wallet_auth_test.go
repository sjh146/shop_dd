package handlers

import (
	"encoding/hex"
	"strings"
	"testing"
)

// TestRandomHex verifies randomHex produces a hex string of the requested
// byte length (2 hex chars per byte).
func TestRandomHex(t *testing.T) {
	// 32 bytes → 64 hex chars
	s, err := randomHex(32)
	if err != nil {
		t.Fatalf("randomHex(32) returned error: %v", err)
	}
	if len(s) != 64 {
		t.Errorf("randomHex(32) length = %d, want 64", len(s))
	}
	if _, err := hex.DecodeString(s); err != nil {
		t.Errorf("randomHex(32) = %q is not valid hex: %v", s, err)
	}

	// 16 bytes → 32 hex chars
	s16, err := randomHex(16)
	if err != nil {
		t.Fatalf("randomHex(16) returned error: %v", err)
	}
	if len(s16) != 32 {
		t.Errorf("randomHex(16) length = %d, want 32", len(s16))
	}

	// Two calls should produce different values (cryptographic randomness).
	s1, _ := randomHex(32)
	s2, _ := randomHex(32)
	if s1 == s2 {
		t.Errorf("randomHex(32) produced identical values %q and %q", s1, s2)
	}
}

// TestPersonalSignHash verifies the EIP-191 personal_sign message hash.
// Expected hash computed independently with viem's keccak256 over
// "\x19Ethereum Signed Message:\n47" + message.
func TestPersonalSignHash(t *testing.T) {
	msg := []byte("shop_dd login (chain 84532)\nnonce: abc123def456")
	got := personalSignHash(msg)
	want := "855d6b0cb821ef362df6346dfb9a9d78c97a7599c1f2a90fa5415ffac467522f"
	if hex.EncodeToString(got) != want {
		t.Errorf("personalSignHash(%q) = %x, want %s", msg, got, want)
	}
}

// TestRecoverAddress verifies EIP-191 signature recovery against a known
// viem-signed vector.
//
// Vector generated with viem (privateKeyToAccount + signMessage):
//   - private key: 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
//   - address:     0x70997970C51812dc3A010C7d01b50e0d17dc79C8
//   - message:     "shop_dd login (chain 84532)\nnonce: abc123def456"
func TestRecoverAddress(t *testing.T) {
	msg := []byte("shop_dd login (chain 84532)\nnonce: abc123def456")
	sig := "0xae76f584afcbdd75e7974ef46fe2f43aea5d00148b7ef1b8ab8e3eaeea065c9c52fa68a768d90706d3497e615b6264b3cd7632afdf98a66b81ac1740e18ce8e11c"
	wantAddr := "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"

	got, err := recoverAddress(msg, sig)
	if err != nil {
		t.Fatalf("recoverAddress returned error: %v", err)
	}
	if !strings.EqualFold(got, wantAddr) {
		t.Errorf("recoverAddress = %s, want %s", got, wantAddr)
	}
}

// TestRecoverAddressInvalidSignature verifies error handling for malformed
// signatures.
func TestRecoverAddressInvalidSignature(t *testing.T) {
	msg := []byte("shop_dd login (chain 84532)\nnonce: abc123def456")

	// Too short (not 65 bytes).
	if _, err := recoverAddress(msg, "0x1234"); err == nil {
		t.Error("recoverAddress with short signature should return error")
	}

	// Empty signature.
	if _, err := recoverAddress(msg, ""); err == nil {
		t.Error("recoverAddress with empty signature should return error")
	}
}

// TestDevSignatureOK verifies the dev-only signature bypass gate.
// Conditions: APP_ENV=="dev" AND DEV_FAKE_SIGNATURE matches (case-insensitive).
func TestDevSignatureOK(t *testing.T) {
	t.Run("dev env with matching signature", func(t *testing.T) {
		t.Setenv("APP_ENV", "dev")
		t.Setenv("DEV_FAKE_SIGNATURE", "0xdev")
		if !devSignatureOK("0xabc", "0xdev") {
			t.Error("devSignatureOK should be true with APP_ENV=dev and matching signature")
		}
	})

	t.Run("dev env with case-insensitive match", func(t *testing.T) {
		t.Setenv("APP_ENV", "dev")
		t.Setenv("DEV_FAKE_SIGNATURE", "0xdev")
		if !devSignatureOK("0xabc", "0xDEV") {
			t.Error("devSignatureOK should be case-insensitive")
		}
	})

	t.Run("prod env always false", func(t *testing.T) {
		t.Setenv("APP_ENV", "prod")
		t.Setenv("DEV_FAKE_SIGNATURE", "0xdev")
		if devSignatureOK("0xabc", "0xdev") {
			t.Error("devSignatureOK must be false in prod")
		}
	})

	t.Run("dev env with wrong signature", func(t *testing.T) {
		t.Setenv("APP_ENV", "dev")
		t.Setenv("DEV_FAKE_SIGNATURE", "0xdev")
		if devSignatureOK("0xabc", "0xwrong") {
			t.Error("devSignatureOK should be false with wrong signature")
		}
	})

	t.Run("dev env with unset fake signature", func(t *testing.T) {
		t.Setenv("APP_ENV", "dev")
		t.Setenv("DEV_FAKE_SIGNATURE", "")
		if devSignatureOK("0xabc", "0xdev") {
			t.Error("devSignatureOK should be false when DEV_FAKE_SIGNATURE is unset")
		}
	})

	t.Run("unset env always false", func(t *testing.T) {
		t.Setenv("APP_ENV", "")
		t.Setenv("DEV_FAKE_SIGNATURE", "0xdev")
		if devSignatureOK("0xabc", "0xdev") {
			t.Error("devSignatureOK must be false when APP_ENV is unset")
		}
	})
}
