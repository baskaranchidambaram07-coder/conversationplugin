// Signs a widget token for your signed-in user. Go 1.18 or later, standard library only.
//
//	UCP_WIDGET_SECRET=... UCP_ISSUER=https://portal.example.org UCP_WIDGET_ID=w_... go run sign.go <user id>
//
// Call WidgetToken(userID) from the endpoint your page's getToken fetches, after checking the user is signed in.
// The user ID must be your stable ID for the user, never an email address or a name.
package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"time"
)

var part = base64.RawURLEncoding.EncodeToString

func WidgetToken(userID string) (string, error) {
	now := time.Now().Unix()
	header := map[string]string{"alg": "HS256", "typ": "JWT"}
	if id := os.Getenv("UCP_SECRET_ID"); id != "" {
		header["kid"] = id // which secret signed it, while two are in use
	}
	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	claims := map[string]any{
		"iss": os.Getenv("UCP_ISSUER"),
		"aud": os.Getenv("UCP_WIDGET_ID"),
		"sub": userID,
		"iat": now,
		"exp": now + 300, // five minutes; the chat asks again when it needs a new one
		"jti": part(random), // used once only
	}
	headerJSON, err := json.Marshal(header)
	if err != nil {
		return "", err
	}
	claimsJSON, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	signed := part(headerJSON) + "." + part(claimsJSON)
	mac := hmac.New(sha256.New, []byte(os.Getenv("UCP_WIDGET_SECRET")))
	mac.Write([]byte(signed))
	return signed + "." + part(mac.Sum(nil)), nil
}

func main() {
	token, err := WidgetToken(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(token)
}
