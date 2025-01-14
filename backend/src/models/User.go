package models

import "time"

const (
	RoleAdmin   = "admin"
	RoleStudent = "student"
)

// User model definition
type User struct {
	ID          int       `json:"user_id"`
	Username    string    `json:"username"`
	Email       string    `json:"email"`
	Phone		string    `json:"phone"` // Make phone number optional
	Password    string    `json:"password"`
	Role        string    `json:"role"`
	CreatedAt   time.Time `json:"created_at"`
}

// Checks if user has admin rights
func (u *User) IsAdmin() bool {
	return u.Role == RoleAdmin
}

// Checks if user is a student
func (u *User) IsStudent() bool {
	return u.Role == RoleStudent
}
