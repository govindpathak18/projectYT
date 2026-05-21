# Backend

This folder contains the Express backend for the YouTube-like MERN project.

The backend will be responsible for:

- handling API requests from the React frontend
- connecting to MongoDB
- managing authentication and authorization
- uploading videos, thumbnails, and profile images to Cloudinary
- storing video metadata, users, comments, likes, playlists, and subscriptions
- integrating AI features for title, thumbnail, summary, and tag generation

## Backend Flow

```txt
React frontend
  sends HTTP request

Express route
  receives request

Middleware
  checks auth, files, validation, etc.

Controller
  handles main business logic

Model
  reads/writes MongoDB data

Response
  sends JSON back to React
```

## Planned AI Upload Assistant

During video upload, the backend will call an AI service to generate:

- video title suggestions
- video summary
- video tags
- video thumbnail

The generated thumbnail will be stored in Cloudinary, while final accepted metadata will be saved in MongoDB.
