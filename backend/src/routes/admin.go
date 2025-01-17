package routes

import (
	"database/sql"
	"net/http"
	admin "qwizza/handlers/admin"
	//"qwizza/handlers"
)

func RegisterAdminRoutes(mux *http.ServeMux, db *sql.DB) {
	mux.HandleFunc("/admin/signup", admin.HandleAdminSignup(db))
	mux.HandleFunc("/admin/login", admin.HandleAdminLogin(db))
	mux.HandleFunc("/admin/createquiz", admin.CreateQuiz(db))
	// mux.HandleFunc("/admin/questions", nil)
}
