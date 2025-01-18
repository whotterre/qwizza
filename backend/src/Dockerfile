FROM golang:1.23-alpine3.21
RUN mkdir /app
ADD . /app/
WORKDIR /app
RUN go mod download
RUN go build server.go
CMD ["/app/server"]
