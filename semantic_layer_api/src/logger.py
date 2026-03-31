import logging

class Logger:
    def __init__(
        self,
        name: str         = "semantic-layer-api",
        level: str  = logging.INFO,
        log_file = None,
        fmt: str = "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt: str = "%Y-%m-%d %H:%M:%S",
    ):
        self._logger = logging.getLogger(name)
        if self._logger.handlers:
            return

        self._logger.setLevel(level)

        formatter = logging.Formatter(fmt=fmt, datefmt=datefmt)

        stream_handler = logging.StreamHandler()
        stream_handler.setFormatter(formatter)
        self._logger.addHandler(stream_handler)

        if log_file:
            file_handler = logging.FileHandler(log_file, encoding="utf-8")
            file_handler.setFormatter(formatter)
            self._logger.addHandler(file_handler)

    # Convenience forwarding methods
    def debug(self, *args, **kwargs):   self._logger.debug(*args, **kwargs)
    def info(self, *args, **kwargs):    self._logger.info(*args, **kwargs)
    def warning(self, *args, **kwargs): self._logger.warning(*args, **kwargs)
    def error(self, *args, **kwargs):   self._logger.error(*args, **kwargs)
    def critical(self, *a, **kw):       self._logger.critical(*a, **kw)

    # If you really need the underlying logger:
    @property
    def raw(self) -> logging.Logger: return self._logger