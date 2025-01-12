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

### POST /auth/login
**Login (returns JWT token).**

**Request Body**:
```json
{
  "username": "admin",
  "password": "password"
}
```

**Response**:
- JWT token for authentication.

---

### GET /quizzes
**List all quizzes (for admin and students).**

**Response**:
```json
[
  {
    "id": 1,
    "title": "Math Quiz",
    "description": "A quiz about math",
    "number_of_questions": 10
  },
  {
    "id": 2,
    "title": "Science Quiz",
    "description": "A quiz about science",
    "number_of_questions": 12
  }
]
```

---

### POST /quizzes
**Admin creates a new quiz.**

**Request Body**:
```json
{
  "title": "New Quiz",
  "description": "Quiz description here"
}
```

**Response**:
```json
{
  "id": 3,
  "title": "New Quiz",
  "description": "Quiz description here"
}
```

---

### GET /quizzes/{id}
**Get details of a single quiz (questions).**

**Response**:
```json
{
  "id": 1,
  "title": "Math Quiz",
  "description": "A quiz about math",
  "questions": [
    {
      "id": 1,
      "text": "What is 2 + 2?",
      "options": ["2", "3", "4", "5"],
      "correct_answer": 3
    },
    {
      "id": 2,
      "text": "What is 3 + 5?",
      "options": ["6", "7", "8", "9"],
      "correct_answer": 3
    }
  ]
}
```

---

### POST /quizzes/{id}/answers
**Submit answers for a quiz.**

**Request Body**:
```json
{
  "answers": [3, 2, 1]  // Indices of selected answers for each question.
}
```

**Response**:
```json
{
  "score": 85
}
```

---

### POST /questions
**Admin creates a new question for a quiz.**

**Request Body**:
```json
{
  "text": "What is 5 + 7?",
  "options": ["10", "11", "12", "13"],
  "correct_answer": 3,
  "quiz_id": 1
}
```

**Response**:
```json
{
  "id": 5,
  "text": "What is 5 + 7?",
  "options": ["10", "11", "12", "13"],
  "correct_answer": 3,
  "quiz_id": 1
}
```

---

### GET /users
**List all students (admin only).**

**Response**:
```json
[
  {
    "id": 1,
    "username": "student1",
    "email": "student1@example.com"
  },
  {
    "id": 2,
    "username": "student2",
    "email": "student2@example.com"
  }
]
```

---

### POST /users
**Admin creates a new student user (optional).**

**Request Body**:
```json
{
  "username": "student3",
  "password": "password123"
}
```

**Response**:
```json
{
  "id": 3,
  "username": "student3",
  "email": "student3@example.com"
}
```

---

## Setup & Installation

### Prerequisites
- Go 1.16 or higher
- MySQL database server

### Installation Steps
1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/quiz-app-api.git
   ```
2. Navigate to the project folder:
   ```bash
   cd quiz-app-api
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
