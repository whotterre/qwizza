package admin

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"qwizza/models"
	"time"
	"github.com/golang-jwt/jwt/v4"
	"golang.org/x/crypto/bcrypt"
)

type APIResponse struct {
	Message string `json:"message"`
	Error   string `json:"error,omitempty"`
}
type LoginResponse struct {
	Message string `json:"message"`
	Token   string `json:"token"`
	Error   string `json:"error,omitempty"`
}
type Claims struct {
	Email string `json:"email"`
	Role  string `json:"role"`
	jwt.RegisteredClaims
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

// Logs in an admin user
func HandleAdminLogin(dbi *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Invalid request method", http.StatusMethodNotAllowed)
			return
		}

		// Parse the request body
		var user models.User
		if err := json.NewDecoder(r.Body).Decode(&user); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(APIResponse{Message: "Couldn't decode request body", Error: err.Error()})
			return
		}

		// Validate required fields
		if user.Email == "" || user.Password == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(APIResponse{Message: "Missing required fields"})
			return
		}

		// Check if user exists in the database
		exists, err := userExists(dbi, user.Email)
		if err != nil {
			log.Printf("Error checking user existence: %v\n", err)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(APIResponse{Message: "Database error", Error: err.Error()})
			return
		}
		if !exists {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(APIResponse{Message: "User not found"})
			return
		}

		// Retrieve the hashed password from the database and compare
		var storedHash, role string
		err = dbi.QueryRow("SELECT password, role FROM users WHERE email = ?", user.Email).Scan(&storedHash, &role)
		if err != nil {
			log.Printf("Error fetching password from the database: %v\n", err)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(APIResponse{Message: "Database error", Error: err.Error()})
			return
		}

		// Compare the hashed password with the provided password
		err = bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(user.Password))
		if err != nil {
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(APIResponse{Message: "Invalid credentials"})
			return
		}

		// Generate JWT token
		claims := &Claims{
			Email: user.Email,
			Role:  "admin",
			RegisteredClaims: jwt.RegisteredClaims{
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)), // Token expires in 24 hours
				Issuer:    "qwizza",
			},
		}
		jwtSecretKey := []byte(os.Getenv("JWT_SECRET"))
		token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
		tokenString, err := token.SignedString(jwtSecretKey)
		if err != nil {
			log.Printf("Error signing token: %v\n", err)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(APIResponse{Message: "Error signing token", Error: err.Error()})
			return
		}

		// Return the token in the response
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(LoginResponse{Message: "Login successful", Error: "", Token: tokenString})
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

// Creates quiz
func CreateQuiz(dbi *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Validate request method
		if r.Method != http.MethodPost {
			http.Error(w, "Invalid request method", http.StatusMethodNotAllowed)
			return
		}

		// Extract JWT from header
		tokenStr := r.Header.Get("Authorization")
		if tokenStr == "" {
			http.Error(w, "Missing authorization token", http.StatusUnauthorized)
			return
		}

		// Parse token
		_, claims, err := parseToken(tokenStr)
		if err != nil || claims.Role != "admin" {
			http.Error(w, "Unauthorized access", http.StatusForbidden)
			return
		}

		// Initialize quiz model and populate with data from request body
		var quiz models.Quiz
		if err := json.NewDecoder(r.Body).Decode(&quiz); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(APIResponse{Message: "Invalid request body", Error: err.Error()})
			return
		}
		// Validate required fields
		if quiz.Title == "" || quiz.Description == "" || quiz.Duration <= 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(APIResponse{Message: "Missing or invalid fields"})
			return
		}
		if len(quiz.Questions) == 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(APIResponse{Message: "A quiz must have questions"})
			return
		}

		// Set start time to current time if not provided
		if quiz.CreatedAt.IsZero() {
			quiz.CreatedAt = time.Now()
		}
		if quiz.StartTime.IsZero() {
			quiz.StartTime = time.Now()
		}

		// Start transaction
		tx, err := dbi.Begin()
		if err != nil {
			log.Printf("Transaction start error: %v\n", err)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(APIResponse{Message: "Failed to create quiz", Error: err.Error()})
			return
		}
		quizQuery := `
		INSERT INTO quiz (TITLE, DESCRIPTION, CREATEDAT, DURATION, STARTTIME)
		VALUES (?,?,?,?,?)
	`

		res, err := tx.Exec(quizQuery, quiz.Title, quiz.Description, quiz.CreatedAt, quiz.Duration, quiz.StartTime)
		if err != nil {
			tx.Rollback()
			log.Printf("Quiz insert error: %v\n", err)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(APIResponse{Message: "Failed to create quiz", Error: err.Error()})
			return
		}

		// Get quiz ID
		quizID, err := res.LastInsertId()
		if err != nil {
			tx.Rollback()
			log.Printf("Failed to retrieve quiz ID: %v\n", err)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(APIResponse{Message: "Failed to create quiz", Error: err.Error()})
			return
		}

		questionQuery := `INSERT INTO question (QUIZ_ID, TITLE, CORRECT_OPTION, OPTIONS) VALUES (?,?,?,?)`
		for _, question := range quiz.Questions {
			optionsJSON, err := json.Marshal(question.Options)
			if err != nil {
				tx.Rollback()
				log.Printf("Failed to marshal options: %v\n", err)
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(APIResponse{Message: "Failed to create quiz", Error: err.Error()})
				return
			}

			_, err = tx.Exec(questionQuery, quizID, question.Title, question.CorrectOption, optionsJSON)
			if err != nil {
				tx.Rollback()
				log.Printf("Question insert error: %v\n", err)
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(APIResponse{Message: "Failed to add questions", Error: err.Error()})
				return
			}
		}

		// Commit the transaction
		if err := tx.Commit(); err != nil {
			log.Printf("Transaction commit error: %v\n", err)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(APIResponse{Message: "Failed to create quiz", Error: err.Error()})
			return
		}

		// Respond with success
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(APIResponse{Message: "Quiz created successfully"})
	}
}

// Update quiz
func UpdateQuiz(dbi *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Validate request method
		if r.Method != http.MethodPut {
			http.Error(w, "Invalid request method", http.StatusMethodNotAllowed)
			return
		}

		// Extract JWT from header
		tokenStr := r.Header.Get("Authorization")
		if tokenStr == "" {
			http.Error(w, "Missing authorization token", http.StatusUnauthorized)
			return
		}

		// Parse token
		_, claims, err := parseToken(tokenStr)
		if err != nil || claims.Role != "admin" {
			http.Error(w, "Unauthorized access", http.StatusForbidden)
			return
		}

		// Parse the quiz data from the request body
		var quiz models.Quiz
		if err := json.NewDecoder(r.Body).Decode(&quiz); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(APIResponse{Message: "Invalid request body", Error: err.Error()})
			return
		}

		// Update quiz in the database
		_, err = dbi.Exec(`
			UPDATE quiz
			SET TITLE = ?, DESCRIPTION = ?, DURATION = ?, STARTTIME = ?
			WHERE QUIZ_ID = ?
		`, quiz.Title, quiz.Description, quiz.Duration, quiz.StartTime, quiz.ID)
		if err != nil {
			log.Printf("Error updating quiz: %v\n", err)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(APIResponse{Message: "Failed to update quiz", Error: err.Error()})
			return
		}

		// Respond with success
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(APIResponse{Message: "Quiz updated successfully"})
	}
}

func parseToken(tokenStr string) (*jwt.Token, *Claims, error) {
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