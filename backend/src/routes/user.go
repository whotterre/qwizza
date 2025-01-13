package routes

import (
	"database/sql"
	"net/http"
	//"qwizza/handlers/user"
)

func RegisterUserRoutes(mux *http.ServeMux, db *sql.DB) {
	mux.HandleFunc("/quizzes", nil)
	mux.HandleFunc("/quizzes/submit", nil)
}
