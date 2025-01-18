package utils

import (
	"fmt"
	"os"
	"strings"
	"github.com/golang-jwt/jwt/v4"
)

type Claims struct {
	Email string `json:"email"`
	Role  string `json:"role"`
	jwt.RegisteredClaims
}

// Parses and decodes a jwt from auth header
func ParseToken(tokenStr string) (*jwt.Token, *Claims, error) {
	if strings.HasPrefix(tokenStr, "Bearer ") {
		tokenStr = tokenStr[len("Bearer "):]
	}
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(os.Getenv("JWT_SECRET")), nil
	})
	if err != nil {
		return nil, nil, err
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, nil, fmt.Errorf("invalid token")
	}

	return token, claims, nil
}