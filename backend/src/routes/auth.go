package routes

import (
	"database/sql"
	"net/http"
	"qwizza/handlers"
)

func RegisterAuthRoutes(mux *http.ServeMux, db *sql.DB) {
	mux.HandleFunc("/login", handlers.LoginHandler(db))
	mux.HandleFunc("/signup", handlers.SignupHandler(db))
}
