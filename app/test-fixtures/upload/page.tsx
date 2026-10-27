"use client";

import { useState } from "react";

export default function UploadTestFixturePage() {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file.name);
      setFileSize(file.size);
      setUploadSuccess(false);
      setError(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setError("Please select a file before submitting.");
      return;
    }
    setUploadSuccess(true);
    setError(null);
  };

  return (
    <div style={{ padding: "30px", fontFamily: "sans-serif", maxWidth: "600px", margin: "0 auto" }}>
      <h1>File Upload Test Fixture</h1>
      <p>Controlled test page for validating file upload targets, file selection, and upload confirmation.</p>

      <div style={{ border: "1px solid #cbd5e1", borderRadius: "8px", padding: "16px", marginTop: "20px" }}>
        <form onSubmit={handleSubmit} id="upload-form">
          <label htmlFor="file-input" style={{ display: "block", marginBottom: "8px", fontWeight: "bold" }}>
            Select Authorized Document:
          </label>
          <input
            id="file-input"
            name="documentUpload"
            data-testid="file-upload-input"
            type="file"
            onChange={handleFileChange}
            style={{ display: "block", marginBottom: "16px" }}
          />

          <button
            type="submit"
            id="submit-upload-btn"
            data-testid="submit-upload-btn"
            style={{
              padding: "8px 16px",
              background: "#16a34a",
              color: "white",
              borderRadius: "4px",
              border: "none",
              cursor: "pointer",
            }}
          >
            Upload File
          </button>
        </form>

        {uploadSuccess && (
          <div
            id="upload-confirmation"
            data-testid="upload-status"
            style={{ marginTop: "16px", padding: "12px", background: "#dcfce7", color: "#15803d", borderRadius: "4px" }}
          >
            File uploaded successfully: {selectedFile} ({fileSize} bytes)
          </div>
        )}

        {error && (
          <div
            data-testid="upload-error"
            style={{ marginTop: "16px", padding: "12px", background: "#fee2e2", color: "#b91c1c", borderRadius: "4px" }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
