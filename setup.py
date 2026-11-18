"""Release guard: a published package must contain the browser IDE.

npm runs only in the release preparation script, never on an end user's install.
"""
from pathlib import Path
from setuptools import setup
from setuptools.command.build_py import build_py
from setuptools.command.sdist import sdist


def require_frontend():
    if not Path('python/reaktiv_workbook/web/index.html').is_file():
        raise RuntimeError('Browser IDE assets are missing. Run npm ci and npm run package:python before publishing.')


class BuildWithFrontend(build_py):
    def run(self):
        if not self.editable_mode:
            require_frontend()
        super().run()


class SourceWithFrontend(sdist):
    def run(self):
        require_frontend()
        super().run()


setup(cmdclass={'build_py': BuildWithFrontend, 'sdist': SourceWithFrontend})
