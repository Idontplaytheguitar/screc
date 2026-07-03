use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("FFmpeg not available: {0}")]
    Ffmpeg(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Zip error: {0}")]
    Zip(#[from] zip::result::ZipError),

    #[error("Platform not supported for this operation: {0}")]
    Platform(String),

    #[error("Recording error: {0}")]
    Recording(String),

    #[error("Export error: {0}")]
    Export(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("{0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

pub type AppResult<T> = Result<T, AppError>;
