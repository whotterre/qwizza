package handlers

import (
	"database/sql"
	"net/http"
)

// Logs in a user
func LoginHandler(dbi *sql.DB) http.HandlerFunc {}
// Signs up a user
func SignupHandler(dbi *sql.DB) http.HandlerFunc {}
// Gets all quizzes
// func GetQuizzes(db *sql.DB) http.HandlerFunc {}
// // Gets info about a quiz 
// func GetQuizById(db *sql.DB) http.HandlerFunc {}