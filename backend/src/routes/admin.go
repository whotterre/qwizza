package routes

import (
	"database/sql"
	"net/http"
	//"qwizza/handlers"
)

func RegisterAdminRoutes(mux *http.ServeMux, db *sql.DB) {
	mux.HandleFunc("/admin/quizzes", nil)
	mux.HandleFunc("/admin/questions", nil)
}
