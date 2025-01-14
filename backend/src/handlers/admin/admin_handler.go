package admin

import (
	"database/sql"
	"encoding/json"
	"golang.org/x/crypto/bcrypt"
	"log"
	"net/http"
	"qwizza/models"
	"time"
)

type APIResponse struct {
	Message string `json:"message"`
	Error   string `json:"error,omitempty"`
}

// Signs up an admin user
func HandleAdminSignup(dbi *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Invalid request method", http.StatusMethodNotAllowed)
			return
		}

		// Parse and validate the request body
		var user models.User
		if err := json.NewDecoder(r.Body).Decode(&user); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(APIResponse{Message: "Invalid request body", Error: err.Error()})
			return
		}
		if user.Username == "" || user.Email == "" || user.Password == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(APIResponse{Message: "Missing required fields"})
			return
		}

		// Check if the email already exists
		exists, err := userExists(dbi, user.Email)
		if err != nil {
			log.Printf("Error checking user existence: %v\n", err)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(APIResponse{Message: "Database error", Error: err.Error()})
			return
		}
		if exists {
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(APIResponse{Message: "Email already registered"})
			return
		}

		// Hash the password
		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(user.Password), bcrypt.DefaultCost)
		if err != nil {
			log.Printf("Error hashing password: %v\n", err)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(APIResponse{Message: "Internal server error", Error: err.Error()})
			return
		}

		// Insert the new admin user into the database
		_, err = dbi.Exec(
			"INSERT INTO users (username, password, email, phone, role, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
			user.Username, string(hashedPassword), user.Email, user.Phone, "admin", time.Now(),
		)
		if err != nil {
			log.Printf("Database error: %v\n", err)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(APIResponse{Message: "Database error", Error: err.Error()})
			return
		}

		// Respond with success
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(APIResponse{Message: "Admin signup successful"})
	}
}

// Helper function to check if a user with the given email already exists
func userExists(dbi *sql.DB, email string) (bool, error) {
	var count int
	err := dbi.QueryRow("SELECT COUNT(*) FROM users WHERE email = ?", email).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}
