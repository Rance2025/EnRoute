from .config import Settings
from .main import create_app


def main() -> None:
    import uvicorn

    settings = Settings.from_env()
    uvicorn.run(create_app(settings=settings), host=settings.host, port=settings.port)


if __name__ == "__main__":
    main()
