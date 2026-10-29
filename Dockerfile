FROM python:3.12-alpine
WORKDIR /app
COPY . /app
EXPOSE 4186
CMD ["python3", "-m", "http.server", "4186", "--bind", "0.0.0.0"]
