import io
import sys

from reaktiv_workbook.output_capture import LineOutput, capture_output


def test_lines_and_flush_publish_once_before_capture_exits():
    entries = []
    output = LineOutput(entries.append)
    warnings = LineOutput(lambda line: entries.append('warning:' + line))
    stdout, stderr = sys.stdout, sys.stderr
    with capture_output(output, warnings):
        print('first')
        assert entries == ['first']
        print('unfinished', end='')
        assert output.getvalue() == 'unfinished'
        print(' line', flush=True)
        print('partial flush', end='', flush=True)
        print('careful', file=sys.stderr, flush=True)
        assert entries == ['first', 'unfinished line', 'partial flush', 'warning:careful']
    output.flush()
    warnings.flush()
    assert len(entries) == 4
    assert sys.stdout is stdout and sys.stderr is stderr


def test_long_lines_and_pending_buffers_are_bounded():
    entries = []
    output = LineOutput(entries.append)
    text = 'x' * (LineOutput.LIMIT * 3 + 5)
    assert output.write(text) == len(text)
    assert len(output.getvalue()) == 5
    output.flush()
    assert ''.join(entries) == text
    assert all(len(entry) <= LineOutput.LIMIT for entry in entries)
    output.flush()
    assert len(entries) == 4


def test_buffered_cell_output_and_host_output_stay_separate():
    output, warnings = io.StringIO(), io.StringIO()
    with capture_output(output, warnings):
        print('ordinary cell', flush=True)
    assert output.getvalue() == 'ordinary cell\n'


def test_chunk_boundaries_preserve_spacing_and_bound_newline_terminated_writes():
    entries = []
    output = LineOutput(entries.append)
    text = 'x' * (LineOutput.LIMIT - 1) + ' ' + 'y' * 100
    output.write(text[:100])
    output.write(text[100:] + '\n')
    output.flush()
    assert ''.join(entries) == text
    assert all(len(entry) <= LineOutput.LIMIT for entry in entries)
