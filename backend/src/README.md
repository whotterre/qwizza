# Qwizza API

## Features

### User Authentication (JWT)
- Admins and students can log in using a username and password.
- Admins have additional privileges (CRUD operations on quizzes and questions).
- Students can only take quizzes and view their scores.

### MySQL Database
- Tables for users, quizzes, questions, answers, and quiz submissions.
- Relationships between quizzes and questions.
- Track which student submitted answers for which quiz.

### Quiz Management
- Admin can create, update, and delete quizzes.
- Admin can create, update, and delete questions associated with quizzes.

### Quiz Timer
- The backend includes timer functionality by tracking the time when the quiz starts and ends.
- Once the time is up or the student submits the quiz, their answers are scored.

### Score Calculation
- When a student submits their answers, their score is calculated by comparing their answers with the correct answers stored in the database.

---

## API Endpoints
### Admin

### POST /admin/signup
**Login (returns JWT token).**

**Request Body**:
```json
{
  "username": "username",
  "password": "password",
  "email" : "jackdoe@gmail.com",
  "phone" : "+234987373723",
}
```

**Successful Response - 200**:
```json 
{
  "message": "Admin signup successful"
}
```
**Response Fraught with Error - 500**:
```json 
{
  "message": "Database error",
  "error": "Info on the database error"
}
---
```
## Setup & Installation

### Prerequisites
- Go 1.16 or higher
- MySQL database server

### Installation Steps
1. Clone the repository:
   ```bash
   git clone https://github.com/whotterre/qwizza
   ```
2. Navigate to the project folder:
   ```bash
   cd qwizza
   ```
3. Install Go dependencies:
   ```bash
   go mod tidy
   ```
4. Set up the MySQL database with the provided schema.
5. Start the server:
   ```bash
   go run main.go
   ```

---

## License
MIT License - See [LICENSE](LICENSE) for more details.

---
