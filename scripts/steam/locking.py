"""Single collector / rebuild process on Linux and Windows."""
import contextlib
import os


@contextlib.contextmanager
def collector_lock(directory):
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (directory/'collector.lock').open('a+') as stream:
        if os.name == 'nt':
            import msvcrt
            stream.seek(0,2)
            if stream.tell() == 0:
                stream.write('0')
                stream.flush()
            stream.seek(0)
            msvcrt.locking(stream.fileno(),msvcrt.LK_NBLCK,1)
            try:
                yield
            finally:
                stream.seek(0)
                msvcrt.locking(stream.fileno(),msvcrt.LK_UNLCK,1)
        else:
            import fcntl
            fcntl.flock(stream,fcntl.LOCK_EX|fcntl.LOCK_NB)
            yield
