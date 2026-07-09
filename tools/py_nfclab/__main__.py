#!/usr/bin/env python3
"""
NFC Frame Monitor - py_nfclab CLI

Displays NFC frames in human-readable format.
Supports both live streams (stdin) and TRZ files.

Usage:
    # Live monitoring
    ./nfc-lab -j | python3 -m py_nfclab

    # Analyze TRZ file
    python3 -m py_nfclab trace.trz

    # Show only Poll/Listen frames (hide carrier events)
    ./nfc-lab -j | python3 -m py_nfclab --no-carrier
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Iterator

from . import (
    NFCFrame,
    parse_nfca_request,
    parse_nfca_response,
    parse_nfcb_request,
    parse_nfcb_response,
    parse_nfcf_request,
    parse_nfcf_response,
    parse_nfcv_request,
    parse_nfcv_response,
)
from .protocol import (
    detect_command,
    decode_select_request,
    decode_select_response,
    decode_generate_ac_request,
    decode_generate_ac_response,
    extract_isodep_payload,
    is_isodep_chained,
    parse_apdu_command,
    parse_apdu_response,
)
from .readers import TRZReader


# ANSI Color codes
class Colors:
    RESET = "\033[0m"
    RED = "\033[91m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    MAGENTA = "\033[95m"
    CYAN = "\033[96m"
    BOLD = "\033[1m"
    GRAY = "\033[90m"


TECH_COLORS = {
    "NfcA": Colors.GREEN,
    "NfcB": Colors.BLUE,
    "NfcF": Colors.MAGENTA,
    "NfcV": Colors.CYAN,
    "Iso7816": Colors.YELLOW,
}

TYPE_COLORS = {
    "Poll": Colors.BOLD + Colors.YELLOW,
    "Listen": Colors.GRAY,
    "CarrierOn": Colors.GREEN,
    "CarrierOff": Colors.RED,
}


def _format_hex(data: bytes, max_hex_chars: int = 32) -> str:
    """Format bytes as hex, truncating if too long."""
    hex_str = data.hex().upper()
    if len(hex_str) > max_hex_chars:
        return f"[{len(data)}B]:{hex_str[:max_hex_chars]}..."
    return f":{hex_str}"


def _format_nfca_poll(frame: NFCFrame) -> str:
    """Format NFC-A Poll frame data section."""
    # Chained I-Block — show raw fragment data
    if is_isodep_chained(frame):
        pcb = frame.data[0]
        offset = 1 + (1 if pcb & 0x08 else 0) + (1 if pcb & 0x04 else 0)
        fragment = frame.data[offset:-2]
        return f"Fragment{_format_hex(fragment)}"

    # 1. Try SELECT APDU
    sel_req = decode_select_request(frame)
    if sel_req:
        return sel_req.format_detail()

    # 2. Try GENERATE AC
    gac_req = decode_generate_ac_request(frame)
    if gac_req:
        return gac_req.format_detail()

    # 3. Try generic APDU (I-Block with C-APDU)
    apdu_payload = extract_isodep_payload(frame)
    if apdu_payload and len(apdu_payload) >= 4:
        apdu = parse_apdu_command(apdu_payload)
        if apdu:
            parts = [f"CLA:{apdu.cla:02X} INS:{apdu.ins:02X}({apdu.ins_name})"]
            parts.append(f"P1:{apdu.p1:02X} P2:{apdu.p2:02X}")
            if apdu.lc is not None and apdu.data:
                parts.append(f"Data{_format_hex(apdu.data)}")
            if apdu.le is not None:
                parts.append(f"Le:{apdu.le}")
            return " ".join(parts)

    # 4. Fallback to raw NFC-A request parsing
    parsed_req = parse_nfca_request(frame)
    if parsed_req:
        parts = [f"Cmd:{parsed_req.cmd:02X}"]
        if parsed_req.params:
            parts.append(f"Params:{parsed_req.params.hex().upper()}")
        if parsed_req.crc:
            parts.append(f"CRC:{parsed_req.crc.hex().upper()}")
        return " ".join(parts)

    return None


def _format_nfca_listen(frame: NFCFrame) -> str:
    """Format NFC-A Listen frame data section."""
    # Chained I-Block — show raw fragment data
    if is_isodep_chained(frame):
        pcb = frame.data[0]
        offset = 1 + (1 if pcb & 0x08 else 0) + (1 if pcb & 0x04 else 0)
        fragment = frame.data[offset:-2]
        return f"Fragment{_format_hex(fragment)}"

    # 1. Try SELECT response (FCI TLV)
    sel_resp = decode_select_response(frame)
    if sel_resp:
        return sel_resp.format_detail()

    # 2. Try GENERATE AC response
    gac_resp = decode_generate_ac_response(frame)
    if gac_resp and (gac_resp.cryptogram_type or gac_resp.tlv_fields):
        return gac_resp.format_detail()

    # 3. Try generic R-APDU
    apdu_payload = extract_isodep_payload(frame)
    if apdu_payload and len(apdu_payload) >= 2:
        rapdu = parse_apdu_response(apdu_payload)
        if rapdu:
            parts = []
            if rapdu.data:
                parts.append(f"Data{_format_hex(rapdu.data)}")
            parts.append(f"SW:{rapdu.sw:04X}({rapdu.sw_name})")
            return " ".join(parts)

    # 4. Fallback to raw NFC-A response parsing
    parsed_resp = parse_nfca_response(frame)
    if parsed_resp:
        parts = []
        if parsed_resp.payload is not None:
            parts.append(f"Payload{_format_hex(parsed_resp.payload)}")
        if parsed_resp.crc:
            parts.append(f"CRC:{parsed_resp.crc.hex().upper()}")
        return " ".join(parts)

    return None


def _format_nfcb_poll(frame: NFCFrame) -> str:
    """Format NFC-B Poll frame data section."""
    parsed_req = parse_nfcb_request(frame)
    if parsed_req:
        parts = [f"Cmd:{parsed_req.cmd:02X}"]
        if parsed_req.params:
            parts.append(f"Params:{parsed_req.params.hex().upper()}")
        if parsed_req.crc:
            parts.append(f"CRC:{parsed_req.crc.hex().upper()}")
        return " ".join(parts)
    return None


def _format_nfcb_listen(frame: NFCFrame) -> str:
    """Format NFC-B Listen frame data section."""
    parsed_resp = parse_nfcb_response(frame)
    if parsed_resp:
        parts = []
        if parsed_resp.payload is not None:
            parts.append(f"Payload{_format_hex(parsed_resp.payload)}")
        if parsed_resp.crc:
            parts.append(f"CRC:{parsed_resp.crc.hex().upper()}")
        return " ".join(parts)
    return None


def _format_nfcf_poll(frame: NFCFrame) -> str:
    """Format NFC-F Poll frame data section."""
    parsed_req = parse_nfcf_request(frame)
    if parsed_req:
        parts = []
        if len(frame.data) > 0:
            parts.append(f"L:{frame.data[0]:02X}")
        parts.append(f"Cmd:{parsed_req.cmd:02X}")
        if parsed_req.body:
            parts.append(f"Body{_format_hex(parsed_req.body)}")
        return " ".join(parts)
    return None


def _format_nfcf_listen(frame: NFCFrame) -> str:
    """Format NFC-F Listen frame data section."""
    parsed_resp = parse_nfcf_response(frame)
    if parsed_resp:
        parts = []
        if len(frame.data) > 0:
            parts.append(f"L:{frame.data[0]:02X}")
        parts.append(f"Cmd:{parsed_resp.cmd:02X}")
        if parsed_resp.body:
            parts.append(f"Body{_format_hex(parsed_resp.body)}")
        return " ".join(parts)
    return None


def _format_nfcv_poll(frame: NFCFrame) -> str:
    """Format NFC-V Poll frame data section."""
    parsed_req = parse_nfcv_request(frame)
    if parsed_req:
        parts = [f"Flag:{parsed_req.flags:02X}", f"Cmd:{parsed_req.cmd:02X}"]
        if parsed_req.uid:
            uid_be = parsed_req.uid_be
            if uid_be:
                parts.append(f"UID:{uid_be.hex().upper()}")
        if parsed_req.params:
            parts.append(f"Params:{parsed_req.params.hex().upper()}")
        if parsed_req.crc:
            parts.append(f"CRC:{parsed_req.crc.hex().upper()}")
        return " ".join(parts)
    return None


def _format_nfcv_listen(frame: NFCFrame) -> str:
    """Format NFC-V Listen frame data section."""
    parsed_resp = parse_nfcv_response(frame)
    if parsed_resp:
        parts = [f"Flag:{parsed_resp.flags:02X}"]
        if parsed_resp.error_code is not None:
            parts.append(
                f"{Colors.RED}ERR:{parsed_resp.error_code:02X}{Colors.RESET}"
            )
        elif parsed_resp.payload is not None:
            parts.append(f"Payload{_format_hex(parsed_resp.payload)}")
        if parsed_resp.crc:
            parts.append(f"CRC:{parsed_resp.crc.hex().upper()}")
        return " ".join(parts)
    return None


# Dispatch table: tech -> (poll_formatter, listen_formatter)
_FORMATTERS = {
    "NfcA": (_format_nfca_poll, _format_nfca_listen),
    "NfcB": (_format_nfcb_poll, _format_nfcb_listen),
    "NfcF": (_format_nfcf_poll, _format_nfcf_listen),
    "NfcV": (_format_nfcv_poll, _format_nfcv_listen),
}


def format_frame(frame: NFCFrame) -> str:
    """Format a single NFC frame for terminal display."""
    tech_color = TECH_COLORS.get(frame.tech, Colors.RESET)
    type_color = TYPE_COLORS.get(frame.type, Colors.RESET)

    # Detect protocol command
    command = detect_command(frame)

    # Header: [timestamp] tech rate type | command |
    output = f"[{Colors.BOLD}{frame.timestamp:>12.6f}{Colors.RESET}] "
    output += f"{tech_color}{frame.tech:>12}{Colors.RESET} "

    rate_str = f"{frame.rate}" if frame.rate else ""
    output += f"{rate_str:>6} "

    output += f"{type_color}{frame.type:>10}{Colors.RESET} | "

    # Command column: 16 characters wide
    command_str = f"{Colors.CYAN}{command}{Colors.RESET}" if command else ""
    visible_len = len(command) if command else 0
    padding = 16 - visible_len
    output += command_str + " " * padding + " | "

    # Data section — delegate to tech-specific formatter
    data_str = None
    if frame.data:
        formatter_pair = _FORMATTERS.get(frame.tech)
        if formatter_pair:
            poll_fmt, listen_fmt = formatter_pair
            if frame.is_poll():
                data_str = poll_fmt(frame)
            elif frame.is_listen():
                data_str = listen_fmt(frame)

    if data_str is not None:
        output += f"{frame.length:3}B | {data_str}"
    else:
        # Raw hex fallback
        hex_data = " ".join(f"{b:02X}" for b in frame.data) if frame.data else "(no data)"
        output += f"{frame.length:3}B | {hex_data}"

    # Error flags
    if frame.errors:
        output += f" {Colors.RED}[{', '.join(frame.errors)}]{Colors.RESET}"

    return output


def read_live_stream(stream) -> Iterator[NFCFrame]:
    """
    Read frames from live JSON stream (one frame per line).

    This handles the extended JSON format from ./nfc-lab -j
    """
    for line in stream:
        line = line.strip()

        # Skip comments and empty lines
        if not line or line.startswith("#"):
            continue

        try:
            data = json.loads(line)

            # Convert extended live format to TRZ format
            # Live format has both camelCase and snake_case, we normalize to TRZ camelCase
            trz_data = {
                "sampleStart": data.get("sample_start", 0),
                "sampleEnd": data.get("sample_end", 0),
                "sampleRate": data.get("sample_rate", 3200000),
                "timeStart": data.get("time_start", data.get("timestamp", 0.0)),
                "timeEnd": data.get("time_end", data.get("timestamp", 0.0)),
                "dateTime": data.get("date_time", 0.0),
                "techType": data.get("tech_type", 0),
                "frameType": data.get("frame_type", 0),
                "framePhase": data.get(
                    "frame_phase", 0x0101
                ),  # Default to NfcCarrierPhase
                "frameRate": data.get("rate", data.get("frame_rate", 0)),
                "frameFlags": data.get("frame_flags", 0),
            }

            # Add frame data if present
            if "data" in data and data["data"]:
                # Live format has hex without separators
                hex_str = data["data"]
                # Add colons every 2 chars for TRZ format
                trz_data["frameData"] = ":".join(
                    hex_str[i : i + 2] for i in range(0, len(hex_str), 2)
                )

            yield NFCFrame.from_trz_dict(trz_data)

        except (json.JSONDecodeError, KeyError):
            # Skip invalid lines silently (nfc-lab may output non-JSON status messages)
            continue


def process_frames(frames: Iterator[NFCFrame], show_carrier: bool = True) -> int:
    """Process and display frames"""
    count = 0

    for frame in frames:
        # Filter carrier events if requested
        if not show_carrier and frame.is_carrier():
            continue

        print(format_frame(frame))
        sys.stdout.flush()
        count += 1

    return count


def main():
    parser = argparse.ArgumentParser(
        description="NFC Frame Monitor",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "file", nargs="?", help="TRZ file to analyze (omit for live stdin mode)"
    )
    parser.add_argument(
        "--no-carrier",
        action="store_true",
        help="Hide carrier on/off events",
    )
    args = parser.parse_args()

    show_carrier = not args.no_carrier

    # Print header
    print(f"{Colors.CYAN}{Colors.BOLD}NFC Frame Monitor{Colors.RESET}")
    if args.file:
        print(f"{Colors.CYAN}File: {args.file}{Colors.RESET}")
    else:
        print(f"{Colors.CYAN}Live mode - reading from stdin{Colors.RESET}")
        print(f"{Colors.GRAY}(Press Ctrl+C to stop){Colors.RESET}")
    print("=" * 80)

    try:
        if args.file:
            # File mode - read TRZ
            file_path = Path(args.file)
            if not file_path.exists():
                print(
                    f"{Colors.RED}Error: File not found: {args.file}{Colors.RESET}",
                    file=sys.stderr,
                )
                sys.exit(1)

            reader = TRZReader(file_path)
            frame_count = process_frames(reader.read_frames(), show_carrier)
        else:
            # Live mode - read from stdin
            frame_count = process_frames(read_live_stream(sys.stdin), show_carrier)

        # Print statistics
        print(f"\n{'=' * 80}")
        print(f"{Colors.YELLOW}Total frames displayed: {frame_count}{Colors.RESET}")

    except KeyboardInterrupt:
        print(f"\n{Colors.YELLOW}Stopped by user{Colors.RESET}")
        sys.exit(0)
    except Exception as e:
        print(f"{Colors.RED}Error: {e}{Colors.RESET}", file=sys.stderr)
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
