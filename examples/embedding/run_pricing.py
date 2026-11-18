"""Run a script-owned pricing workbook, optionally with a live editor."""

from pathlib import Path
import argparse
import time
from reaktiv_workbook import WorkbookSession


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--editor", action="store_true", help="Open the live workbook editor"
    )
    parser.add_argument(
        "--app-url",
        help="Local app preview URL; otherwise serve an existing production build",
    )
    parser.add_argument(
        "--steps",
        type=int,
        default=0,
        help="Stop after this many updates; 0 runs until Ctrl+C",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=1,
        help="Seconds between business-process updates",
    )
    args = parser.parse_args()
    if args.steps < 0 or args.interval < 0:
        parser.error("steps and interval must be nonnegative")
    with WorkbookSession.load(Path(__file__).with_name("pricing.workbook.py")) as session:
        if args.editor:
            session.open_editor(args.app_url)
        step = 0
        try:
            while args.steps == 0 or step < args.steps:
                session.inputs.quantity.update(lambda quantity: quantity + 1)
                print(
                    f"quantity={session.values.quantity()} total={session.values.total():.2f}",
                    flush=True,
                )
                step += 1
                if args.steps == 0 or step < args.steps:
                    time.sleep(args.interval)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
