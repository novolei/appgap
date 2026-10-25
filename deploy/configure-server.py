"""Read AppGap secrets from stdin. Never log their values."""
import json
import os
import pathlib
import sys

values = json.load(sys.stdin)
assert isinstance(values, dict) and values
assert set(values) <= {"SITE_PASSWORD", "DEEPSEEK_API_KEY", "DEEPSEEK_MODEL"}
assert all(isinstance(v, str) and v and "\n" not in v and "\r" not in v for v in values.values())
path = pathlib.Path("/etc/appgap.env")
lines = [line for line in path.read_text().splitlines() if not any(line.startswith(k + "=") for k in values)]
temporary = path.with_name(".appgap.env.new")
fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as stream:
    stream.write("\n".join(lines + [k + "=" + v for k, v in values.items()]) + "\n")
    stream.flush()
    os.fsync(stream.fileno())
os.replace(temporary, path)
print("APPGAP_CONFIGURATION_UPDATED_VALUES_REDACTED")
