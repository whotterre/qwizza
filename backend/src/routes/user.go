package routes

import (
	"database/sql"
	"net/http"
	user "qwizza/handlers/user"
)

func RegisterUserRoutes(mux *http.ServeMux, db *sql.DB) {
	mux.HandleFunc("/quizzes", user.GetQuizzes(db))
	// mux.HandleFunc("/quizzes/submit", nil)
}
