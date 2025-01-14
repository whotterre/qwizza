package routes

import (
	"database/sql"
	"net/http"
	admin "qwizza/handlers/admin"
	//"qwizza/handlers"
)

func RegisterAdminRoutes(mux *http.ServeMux, db *sql.DB) {
	mux.HandleFunc("/admin/signup", admin.HandleAdminSignup(db))
	// mux.HandleFunc("/admin/quizzes", nil)
	// mux.HandleFunc("/admin/questions", nil)
}
