"""Console-capable UCI entry point bundled beside the windowless Chess Lab app."""
from app.torch_compat import install

install()
from maia3.uci import main  # noqa: E402 (needs the torch backports first)


if __name__ == "__main__":
    main()
