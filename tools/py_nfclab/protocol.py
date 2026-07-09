"""
NFC Protocol Command Detection and Parsing

Stateless protocol command detection for NFC frames.
Based on ISO/IEC standards and common NFC implementations.

This module provides:
- Command detection for NFC-A, NFC-B, NFC-F, NFC-V, ISO-DEP, and ISO 7816
- Protocol-specific parsers for request/response frames
- Context-aware payload interpretation where possible

Note: Stateless detection has limitations. Some response types (SAK, UID, ATS)
cannot be reliably identified without context from previous Poll frames.
"""

from dataclasses import dataclass
from typing import Any, Dict, Optional

from .models import NFCFrame

# =============================================================================
# Protocol Command Tables
# =============================================================================

# NFC-A Commands (ISO/IEC 14443-A + common extensions)
NFC_A_COMMANDS = {
    # ISO/IEC 14443-A standard
    0x26: "REQA",
    0x52: "WUPA",
    0xE0: "RATS",
    # Ultralight/NTAG commands
    0x30: "READ",
    0x3A: "FAST_READ",
    0x39: "READ_CNT",
    0x3C: "READ_SIG",
    0x60: "GET_VERSION",  # NTAG/Ultralight EV1
    0xA0: "COMPAT_WRITE",  # Ultralight compatibility write
    0xA2: "WRITE",
    0xA5: "INCR_CNT",
    0x1A: "AUTH",  # Ultralight C
    0x1B: "PWD_AUTH",  # Ultralight EV1
    # MIFARE Classic
    0xB0: "TRANSFER",
    0xC0: "DECREMENT",
    0xC1: "INCREMENT",
    0xC2: "RESTORE",
}

# NFC-B Commands (ISO/IEC 14443-B)
NFC_B_COMMANDS = {
    0x05: "REQB",
    0x08: "WUPB",
    0x1D: "ATTRIB",
    0x50: "HLTB",
}

# NFC-F Commands (FeliCa / JIS X 6319-4)
NFC_F_COMMANDS = {
    0x00: "POLLING",  # aka REQC
    0x02: "RequestResponse",
    0x04: "RequestService",
    0x06: "Read",  # Read Without Encryption
    0x08: "Write",  # Write Without Encryption
    0x0A: "RequestSystemCode",
    0x0C: "Authentication1",
    0x0E: "Authentication2",
    0x10: "ReadSecure",  # Read with Encryption
    0x12: "WriteSecure",  # Write with Encryption
    0x1A: "RequestSpecVersion",
    0x1C: "ResetMode",
}

# NFC-V Commands (ISO/IEC 15693)
NFC_V_COMMANDS = {
    # Standard commands (ISO/IEC 15693-3)
    0x01: "Inventory",
    0x02: "StayQuiet",
    0x20: "ReadSingleBlock",
    0x21: "WriteSingleBlock",
    0x22: "LockBlock",
    0x23: "ReadMultipleBlocks",
    0x24: "WriteMultipleBlocks",
    0x25: "Select",
    0x26: "ResetToReady",
    0x27: "WriteAFI",
    0x28: "LockAFI",
    0x29: "WriteDSFID",
    0x2A: "LockDSFID",
    0x2B: "GetSystemInfo",
    0x2C: "GetMultipleBlockSecStatus",
    0x2D: "FastReadMultiple",
    # Extended commands (large block addresses)
    0x30: "ExtReadSingleBlock",
    0x31: "ExtWriteSingleBlock",
    0x32: "ExtLockSingleBlock",
    0x33: "ExtReadMultipleBlocks",
    0x34: "ExtWriteMultipleBlocks",
    0x35: "Authenticate",
    0x39: "Challenge",
    0x3A: "ReadBuffer",
    0x3B: "ExtGetSystemInfo",
    0x3C: "ExtGetMultiBlockSec",
    0x3D: "FastExtReadMultiple",
    # Fast commands (tag-specific)
    0xC0: "FastReadSingleBlock",
    0xC1: "WriteConfiguration",
    0xC2: "PickRandomUID",
    0xC3: "FastReadMultipleBlocks",
}

# NFC-V Error codes
NFC_V_ERROR_CODES = {
    0x01: "Not supported",
    0x02: "Not recognized",
    0x0F: "Unknown",
    0x10: "Block N/A",
    0x11: "Already locked",
    0x12: "Locked",
    0x13: "Not programmed",
    0x14: "Not locked",
}

# ISO-DEP (ISO/IEC 14443-4) - works on top of NFC-A/B
ISO_DEP_I_BLOCK_MASK = 0x80  # I-Block: bit 7 = 0


# =============================================================================
# Helper Functions
# =============================================================================


def _strip_crc_if_present(data: bytes) -> tuple[bytes, Optional[bytes]]:
    """Strip CRC (last 2 bytes) if frame is long enough"""
    CRC_LEN = 2
    if len(data) >= 4:
        return data[:-CRC_LEN], data[-CRC_LEN:]
    return data, None


# =============================================================================
# NFC-A (ISO/IEC 14443-A + ISO-DEP) Protocol Parsing
# =============================================================================

ATQA_LEN = 2  # Answer To Request A


@dataclass
class NfcARequest:
    """Parsed NFC-A request frame (ISO 14443-A)"""

    cmd: int
    params: Optional[bytes] = None
    crc: Optional[bytes] = None

    def __str__(self) -> str:
        parts = [f"Cmd:{self.cmd:02X}"]
        if self.params:
            parts.append(f"Params:{self.params.hex().upper()}")
        if self.crc:
            parts.append(f"CRC:{self.crc.hex().upper()}")
        return " | ".join(parts)


@dataclass
class NfcAResponse:
    """Parsed NFC-A response frame (ISO 14443-A)"""

    payload: Optional[bytes] = None
    crc: Optional[bytes] = None
    request_cmd: Optional[int] = None

    def __str__(self) -> str:
        if not self.payload:
            return f"CRC:{self.crc.hex().upper()}" if self.crc else "Empty"
        interp = self._interpret_payload()
        if interp:
            return interp
        parts = [f"Payload:{self.payload.hex().upper()}"]
        if self.crc:
            parts.append(f"CRC:{self.crc.hex().upper()}")
        return " | ".join(parts)

    def _interpret_payload(self) -> Optional[str]:
        """Interpret payload based on heuristics and request context"""
        p = self.payload
        if not p:
            return None

        # ATQA (2B)
        if len(p) == ATQA_LEN:
            return f"ATQA:{p.hex().upper()}"

        # SAK (1B) - stateless uncertain
        if len(p) == 1:
            return f"SAK:{p[0]:02X}"

        # ATS after RATS: TL | [T0][TA][TB][TC]... (min 1B)
        if self.request_cmd == 0xE0 and len(p) >= 1:
            tl = p[0]
            if tl == len(p):  # Simple plausibility check
                return f"ATS[{tl}B]:{p.hex().upper()}"

        # UID (4/7/10B) heuristic
        if len(p) in (4, 7, 10):
            return f"UID:{p.hex().upper()}"

        return None


def parse_nfca_request(frame: NFCFrame) -> Optional[NfcARequest]:
    """Parse NFC-A request frame (Poll frames)"""
    if frame.tech != "NfcA" or not frame.data or not frame.is_poll():
        return None
    data, crc = _strip_crc_if_present(frame.data)
    cmd = data[0]
    params = data[1:] if len(data) > 1 else None
    return NfcARequest(cmd=cmd, params=params if params else None, crc=crc)


def parse_nfca_response(
    frame: NFCFrame, request_cmd: Optional[int] = None
) -> Optional[NfcAResponse]:
    """Parse NFC-A response frame (Listen frames)"""
    if frame.tech != "NfcA" or not frame.data or frame.is_poll():
        return None
    data, crc = _strip_crc_if_present(frame.data)
    return NfcAResponse(
        payload=data if data else None, crc=crc, request_cmd=request_cmd
    )


# =============================================================================
# NFC-B (ISO/IEC 14443-B) Protocol Parsing
# =============================================================================

ATQB_MIN_LEN = 11  # PUPI(4) + AppData(4) + ProtInfo(3)


@dataclass
class NfcBRequest:
    """Parsed NFC-B request frame (ISO 14443-B)"""

    cmd: int
    params: Optional[bytes] = None
    crc: Optional[bytes] = None

    def __str__(self) -> str:
        parts = [f"Cmd:{self.cmd:02X}"]
        if self.params:
            parts.append(f"Params:{self.params.hex().upper()}")
        if self.crc:
            parts.append(f"CRC:{self.crc.hex().upper()}")
        return " | ".join(parts)


@dataclass
class NfcBResponse:
    """Parsed NFC-B response frame (ISO 14443-B)"""

    payload: Optional[bytes] = None
    crc: Optional[bytes] = None
    request_cmd: Optional[int] = None

    def __str__(self) -> str:
        if not self.payload:
            return f"CRC:{self.crc.hex().upper()}" if self.crc else "Empty"
        interp = self._interpret_payload()
        if interp:
            return interp
        parts = [f"Payload:{self.payload.hex().upper()}"]
        if self.crc:
            parts.append(f"CRC:{self.crc.hex().upper()}")
        return " | ".join(parts)

    def _interpret_payload(self) -> Optional[str]:
        """Interpret payload based on request context"""
        p = self.payload
        if not p:
            return None

        # ATQB after REQB/WUPB: 11B (without CRC)
        if self.request_cmd in (0x05, 0x08) and len(p) >= ATQB_MIN_LEN:
            pupi = p[0:4].hex().upper()
            app = p[4:8].hex().upper()
            proto = p[8:11].hex().upper()
            rest = p[11:].hex().upper()
            result = f"ATQB PUPI:{pupi} AppData:{app} ProtInfo:{proto}"
            if rest:
                result += f" Extra:{rest}"
            return result

        # ATTRIB response
        if self.request_cmd == 0x1D:
            return f"ATTRIB-Resp:{p.hex().upper()}"

        return None


def parse_nfcb_request(frame: NFCFrame) -> Optional[NfcBRequest]:
    """Parse NFC-B request frame (Poll frames)"""
    if frame.tech != "NfcB" or not frame.data or not frame.is_poll():
        return None
    data, crc = _strip_crc_if_present(frame.data)
    cmd = data[0]
    params = data[1:] if len(data) > 1 else None
    return NfcBRequest(cmd=cmd, params=params if params else None, crc=crc)


def parse_nfcb_response(
    frame: NFCFrame, request_cmd: Optional[int] = None
) -> Optional[NfcBResponse]:
    """Parse NFC-B response frame (Listen frames)"""
    if frame.tech != "NfcB" or not frame.data or frame.is_poll():
        return None
    data, crc = _strip_crc_if_present(frame.data)
    return NfcBResponse(
        payload=data if data else None, crc=crc, request_cmd=request_cmd
    )


# =============================================================================
# NFC-F (FeliCa / JIS X 6319-4) Protocol Parsing
# =============================================================================


@dataclass
class NfcFRequest:
    """Parsed NFC-F request frame (FeliCa)"""

    cmd: int
    body: Optional[bytes] = None  # after CMD (without L)

    def __str__(self) -> str:
        parts = [f"Cmd:{self.cmd:02X}"]
        if self.body:
            parts.append(f"Body:{self.body.hex().upper()}")
        return " | ".join(parts)


@dataclass
class NfcFResponse:
    """Parsed NFC-F response frame (FeliCa)"""

    cmd: int
    body: Optional[bytes] = None  # after CMD (without L)
    request_cmd: Optional[int] = None

    def __str__(self) -> str:
        interp = self._interpret_body()
        if interp:
            return interp
        parts = [f"Cmd:{self.cmd:02X}"]
        if self.body:
            parts.append(f"Body:{self.body.hex().upper()}")
        return " | ".join(parts)

    def _interpret_body(self) -> Optional[str]:
        """Interpret body based on request context"""
        b = self.body or b""

        # POLLING (0x00) response: IDm(8) PMm(8) [SysCodes...]
        if self.request_cmd == 0x00 and len(b) >= 16:
            idm = b[0:8].hex().upper()
            pmm = b[8:16].hex().upper()
            rest = b[16:]
            result = f"POLLING IDm:{idm} PMm:{pmm}"
            if rest:
                syscodes = " ".join(
                    [rest[i : i + 2].hex().upper() for i in range(0, len(rest), 2)]
                )
                result += f" SysCodes:{syscodes}"
            return result

        # Read/Write Without Encryption (0x06/0x08)
        # Format: IDm(8) + SF1(1) + SF2(1) + Data...
        if self.request_cmd in (0x06, 0x08) and len(b) >= 10:
            idm = b[0:8].hex().upper()
            sf1 = b[8]  # Status Flag 1
            sf2 = b[9]  # Status Flag 2
            data = b[10:].hex().upper() if len(b) > 10 else ""
            return f"IDm:{idm} SF1:{sf1:02X} SF2:{sf2:02X} Data:{data}"

        return None


def parse_nfcf_request(frame: NFCFrame) -> Optional[NfcFRequest]:
    """Parse NFC-F request frame (Poll frames)"""
    if frame.tech != "NfcF" or not frame.data or not frame.is_poll():
        return None
    if len(frame.data) < 2:
        return None
    L = frame.data[0]
    cmd = frame.data[1]
    # L-byte consistency check: L should equal total frame length
    # If mismatch, assume CRC (2B) is present and strip it
    if L == len(frame.data):
        # L matches total length - use L directly
        body = frame.data[2:L]
    elif len(frame.data) >= 4:
        # L mismatch - assume CRC (2B) at end, strip it
        body = frame.data[2:-2]
    else:
        # Too short for CRC
        body = frame.data[2:]
    return NfcFRequest(cmd=cmd, body=body if body else None)


def parse_nfcf_response(
    frame: NFCFrame, request_cmd: Optional[int] = None
) -> Optional[NfcFResponse]:
    """Parse NFC-F response frame (Listen frames)"""
    if frame.tech != "NfcF" or not frame.data or frame.is_poll():
        return None
    if len(frame.data) < 2:
        return None
    L = frame.data[0]
    cmd = frame.data[1]
    # L-byte consistency check: L should equal total frame length
    # If mismatch, assume CRC (2B) is present and strip it
    if L == len(frame.data):
        # L matches total length - use L directly
        body = frame.data[2:L]
    elif len(frame.data) >= 4:
        # L mismatch - assume CRC (2B) at end, strip it
        body = frame.data[2:-2]
    else:
        # Too short for CRC
        body = frame.data[2:]
    return NfcFResponse(cmd=cmd, body=body if body else None, request_cmd=request_cmd)


# =============================================================================
# NFC-V (ISO 15693) Protocol Parsing
# =============================================================================


class NfcVFlags:
    """Compact NFC-V flag parser for ISO 15693 request/response flags"""

    def __init__(self, flags: int, is_request: bool = True):
        self.flags = flags
        self.is_request = is_request
        self.is_inv = bool(flags & 0x04)  # Inventory flag

    def __str__(self) -> str:
        """Human-readable flag description"""
        parts = []
        f = self.flags

        if self.is_request:
            # Subcarrier/HDR only meaningful in requests
            parts.append("Dual" if f & 0x01 else "Single")
            parts.append("HDR" if f & 0x02 else "LDR")

            if self.is_inv:  # Inventory
                parts.append("INV")
                if f & 0x10:
                    parts.append("AFI")
                parts.append("1-slot" if f & 0x20 else "16-slot")
            else:  # Non-Inventory
                if f & 0x10:
                    parts.append("SEL")
                if f & 0x20:
                    parts.append("ADDR")
                # Note: ⚠NONE warning removed here - use check() method instead
            if f & 0x08:
                parts.append("EXT")
            if f & 0x40:
                parts.append("OPT")
        else:  # Response
            # In responses, bit0=error, bit1 not used for subcarrier
            if f & 0x01:
                parts.append("⚠ERR")
            if f & 0x08:
                parts.append("EXT")

        return f"0x{f:02X}[{','.join(parts)}]"

    def check(self) -> Optional[str]:
        """Return warning if flags are problematic, None if OK"""
        if not self.is_request or self.is_inv:
            return None
        sel = bool(self.flags & 0x10)
        addr = bool(self.flags & 0x20)
        if not (sel or addr):
            return (
                "No SEL/ADDR - Non-addressed mode; response depends on selection state"
            )
        return None


def parse_nfcv_flags(frame: NFCFrame) -> Optional[str]:
    """Parse NFC-V flags from frame - returns compact string or None"""
    if frame.tech != "NfcV" or not frame.data:
        return None

    flags = NfcVFlags(frame.data[0], frame.is_poll())
    result = str(flags)

    # Add error code if response with error
    if not flags.is_request and (flags.flags & 0x01) and len(frame.data) >= 2:
        err_code = frame.data[1]
        err_msg = NFC_V_ERROR_CODES.get(err_code, f"0x{err_code:02X}")
        result += f" ERR:{err_msg}"

    # Add warning if problematic
    warning = flags.check()
    if warning:
        result += f" ⚠{warning}"

    return result


@dataclass
class NfcVRequest:
    """Parsed NFC-V request frame (ISO 15693)"""

    flags: int
    cmd: int
    uid: Optional[bytes] = None
    params: Optional[bytes] = None
    crc: Optional[bytes] = None

    def __str__(self) -> str:
        parts = [f"Flags:0x{self.flags:02X}"]
        cmd_name = NFC_V_COMMANDS.get(self.cmd, f"0x{self.cmd:02X}")
        parts.append(f"Cmd:{cmd_name}")
        if self.uid:
            parts.append(f"UID:{self.uid.hex().upper()}(LE)")
        if self.params:
            # Special formatting for Inventory params
            is_inv = bool(self.flags & 0x04)
            if is_inv and len(self.params) >= 1:
                # Inventory: [AFI] + MaskLen + Mask
                off = 0
                param_parts = []
                if self.flags & 0x10:  # AFI present
                    param_parts.append(f"AFI:{self.params[off]:02X}")
                    off += 1
                if len(self.params) > off:
                    mask_len = self.params[off]
                    param_parts.append(f"MaskLen:{mask_len}")
                    off += 1
                    if len(self.params) > off:
                        mask = self.params[off:]
                        param_parts.append(f"Mask:{mask.hex().upper()}")
                parts.append(" ".join(param_parts))
            else:
                parts.append(f"Params:{self.params.hex().upper()}")
        if self.crc:
            parts.append(f"CRC:{self.crc.hex().upper()}")
        return " | ".join(parts)

    @property
    def uid_be(self) -> Optional[bytes]:
        """UID in big-endian (human-readable) format"""
        return bytes(reversed(self.uid)) if self.uid else None


@dataclass
class NfcVResponse:
    """Parsed NFC-V response frame (ISO 15693)"""

    flags: int
    payload: Optional[bytes] = None
    crc: Optional[bytes] = None
    error_code: Optional[int] = None
    request_cmd: Optional[int] = None  # Optional: command from previous request

    def __str__(self) -> str:
        parts = [f"Flags:0x{self.flags:02X}"]
        if self.error_code is not None:
            err_msg = NFC_V_ERROR_CODES.get(self.error_code, f"0x{self.error_code:02X}")
            parts.append(f"ERR:{err_msg}")
        if self.payload is not None:  # Allow empty payload (b"")
            # Context-aware payload interpretation
            if self.request_cmd is not None and not self.is_error:
                interpreted = self._interpret_payload()
                if interpreted:
                    parts.append(interpreted)
                else:
                    parts.append(f"Payload:{self.payload.hex().upper()}")
            else:
                parts.append(f"Payload:{self.payload.hex().upper()}")
        if self.crc:
            parts.append(f"CRC:{self.crc.hex().upper()}")
        return " | ".join(parts)

    @property
    def is_error(self) -> bool:
        """Check if response is an error"""
        return bool(self.flags & 0x01)

    @property
    def uid(self) -> Optional[bytes]:
        """Extract UID from Inventory response (if applicable)"""
        if self.request_cmd == 0x01 and self.payload and len(self.payload) >= 8:
            # Inventory response payload: [DSFID?] + UID(8) (CRC already removed)
            if len(self.payload) == 9:  # With DSFID
                return self.payload[1:9]
            elif len(self.payload) == 8:  # Without DSFID
                return self.payload[0:8]
        return None

    @property
    def uid_be(self) -> Optional[bytes]:
        """UID in big-endian (human-readable) format"""
        uid = self.uid
        return bytes(reversed(uid)) if uid else None

    def _interpret_payload(self) -> Optional[str]:
        """Interpret payload based on request command"""
        if not self.payload or self.request_cmd is None:
            return None

        cmd = self.request_cmd
        data = self.payload

        # Inventory (0x01): DSFID? + UID(8)
        if cmd == 0x01:
            if len(data) == 9:  # With DSFID
                dsfid = data[0]
                uid = data[1:9]
                uid_be = bytes(reversed(uid))
                return f"DSFID:0x{dsfid:02X} UID:{uid_be.hex().upper()}"
            elif len(data) == 8:  # Without DSFID
                uid_be = bytes(reversed(data))
                return f"UID:{uid_be.hex().upper()}"

        # GetSystemInfo (0x2B): InfoFlags + fields
        if cmd == 0x2B and len(data) >= 1:
            info_flags = data[0]
            parts = [f"InfoFlags:0x{info_flags:02X}"]
            # Simple interpretation: just show raw for now
            if len(data) > 1:
                parts.append(f"Data:{data[1:].hex().upper()}")
            return " ".join(parts)

        # ReadSingleBlock (0x20), ExtReadSingleBlock (0x30)
        if cmd in (0x20, 0x30):
            return f"BlockData:{data.hex().upper()}"

        # ReadMultipleBlocks (0x23), ExtReadMultipleBlocks (0x33)
        if cmd in (0x23, 0x33):
            return f"BlockData[{len(data)}B]:{data.hex().upper()}"

        # GetMultipleBlockSecurityStatus (0x2C)
        if cmd == 0x2C:
            return f"SecurityStatus:{data.hex().upper()}"

        return None


def parse_nfcv_response(
    frame: NFCFrame, request_cmd: Optional[int] = None
) -> Optional[NfcVResponse]:
    """Parse NFC-V response frame (Listen frames)"""
    if frame.tech != "NfcV" or not frame.data or frame.is_poll():
        return None

    data = frame.data
    flags = data[0]

    # Error response: Flags(1) + ErrorCode(1) + CRC(2)
    if flags & 0x01:  # Error flag
        error_code = data[1] if len(data) >= 2 else None
        crc = data[-2:] if len(data) >= 4 else None
        return NfcVResponse(
            flags=flags, error_code=error_code, crc=crc, request_cmd=request_cmd
        )

    # Success response: Flags(1) + Payload + CRC(2)
    payload = data[1:-2] if len(data) >= 4 else (data[1:] if len(data) > 1 else None)
    crc = data[-2:] if len(data) >= 4 else None

    return NfcVResponse(flags=flags, payload=payload, crc=crc, request_cmd=request_cmd)


def parse_nfcv_request(frame: NFCFrame) -> Optional[NfcVRequest]:
    """Parse NFC-V request frame (Poll frames)"""
    if (
        frame.tech != "NfcV"
        or not frame.data
        or len(frame.data) < 2
        or not frame.is_poll()
    ):
        return None

    data = frame.data
    flags = data[0]
    cmd = data[1]
    off = 2

    is_inv = bool(flags & 0x04)
    addressed = bool(flags & 0x20)

    params: Optional[bytes]

    if is_inv:  # Inventory - special layout
        # F | CMD | [AFI] | MaskLen | Mask | CRC
        afi = None
        if flags & 0x10:  # AFI present
            if len(data) > off:
                afi = data[off]
                off += 1

        # Read MaskLen (in bits) - always present per ISO 15693
        mask_len_bits = data[off] if len(data) > off else 0
        off += 1

        # Calculate mask length in bytes
        mask_len_bytes = (mask_len_bits + 7) // 8
        mask = (
            data[off : off + mask_len_bytes]
            if len(data) >= off + mask_len_bytes
            else b""
        )

        # Build params: [AFI] + MaskLen + Mask (MaskLen always included)
        params_list = []
        if afi is not None:
            params_list.append(afi)
        params_list.append(mask_len_bits)  # Always present
        params_list.extend(mask)

        params = bytes(params_list)
        crc = data[-2:] if len(data) >= 4 else None

        return NfcVRequest(flags=flags, cmd=cmd, params=params, crc=crc)

    # Non-Inventory
    uid = None
    if addressed and len(data) >= off + 8:
        uid = data[off : off + 8]
        off += 8

    # Remaining bytes (excluding CRC, minimum 4 bytes total for valid frame)
    if len(data) >= off + 2:
        params_slice = data[off:-2]
        params = params_slice if params_slice else None
    else:
        params = None
    crc = data[-2:] if len(data) >= 4 else None

    return NfcVRequest(flags=flags, cmd=cmd, uid=uid, params=params, crc=crc)


# =============================================================================
# ISO-DEP (ISO/IEC 14443-4) I-Block APDU Extraction
# =============================================================================


def is_isodep_chained(frame: NFCFrame) -> bool:
    """
    Check if an ISO-DEP I-Block frame has the chaining bit set.

    When chaining is active (PCB bit 4 = 1), the frame contains a fragment
    of a larger APDU — the last 2 bytes are CRC, not SW1/SW2.

    ISO 14443-4 I-Block PCB: 0 0 0 C 0 0 N S
      - Bit 7 (0x80) = 0 (I-Block identifier)
      - Bit 4 (0x10) = Chaining
      - Bit 0 (0x01) = Block number (sequence)

    Returns True if the frame is a chained I-Block, False otherwise.
    """
    if frame.tech not in ("NfcA", "NfcB") or not frame.data or len(frame.data) < 6:
        return False

    pcb = frame.data[0]

    # Must be an I-Block: bit 7 = 0, bits 6-5 must be 0 (not R/S-block)
    if pcb & 0xE0:
        return False

    # Chaining bit: bit 4 (0x10)
    return bool(pcb & 0x10)


def extract_isodep_payload(frame: NFCFrame) -> Optional[bytes]:
    """
    Extract the APDU payload from an ISO-DEP I-Block frame.

    Strips PCB, optional CID/NAD bytes, and trailing CRC to return
    the raw APDU (C-APDU for Poll, R-APDU for Listen).

    Returns None if the frame is not an I-Block, is chained, or too short.
    Chained frames should be handled separately (use is_isodep_chained()).
    """
    if frame.tech not in ("NfcA", "NfcB") or not frame.data or len(frame.data) < 4:
        return None

    data = frame.data
    pcb = data[0]

    # I-Block: bit 7 = 0
    if pcb & 0x80:
        return None

    # Chained frame — payload is incomplete, don't parse as APDU
    if pcb & 0x10:
        return None

    offset = 1

    # CID present: bit 3 of PCB (ISO 14443-4 §7.1)
    if pcb & 0x08:
        offset += 1

    # NAD present: bit 2 of PCB
    if pcb & 0x04:
        offset += 1

    # Payload is between header and CRC (last 2 bytes)
    if len(data) < offset + 2:
        return None

    payload = data[offset:-2]
    return payload if payload else None


# =============================================================================
# ISO 7816-4 APDU Parsing
# =============================================================================

# Well-known AIDs (Application Identifiers)
KNOWN_AIDS = {
    "325041592e5359532e4444463031": "2PAY.SYS.DDF01 (PPSE)",
    "315041592e5359532e4444463031": "1PAY.SYS.DDF01 (PSE)",
    "a0000000031010": "Visa Credit/Debit",
    "a0000000032010": "Visa Electron",
    "a0000000041010": "Mastercard Credit/Debit",
    "a0000000042010": "Mastercard Maestro",
    "a000000004101001": "Mastercard (US)",
    "a000000025010104": "Amex",
    "a000000025010701": "Amex (ExpressPay)",
    "a0000000651010": "JCB",
    "a0000003330101": "UnionPay Debit",
    "a0000003241010": "Discover",
    "a000000152": "Diners Club",
    "a0000000780001": "Cubic (Clipper)",
    "a0000007800003": "Cubic (Transit)",
    "d2760000850101": "NDEF (NFC Forum)",
}

# ISO 7816-4 SELECT P1 values
SELECT_P1 = {
    0x00: "MF/EF/DF by ID",
    0x01: "Child DF",
    0x02: "EF under DF",
    0x03: "Parent DF",
    0x04: "DF by name (AID)",
    0x08: "from MF",
    0x09: "from current DF",
}

# ISO 7816-4 SELECT P2 values (file control info)
SELECT_P2_FCI = {
    0x00: "FCI",
    0x04: "FCP",
    0x08: "FMD",
    0x0C: "No response",
}

# Common ISO 7816 status words
STATUS_WORDS = {
    0x9000: "OK",
    0x6100: "More data available",
    0x6200: "Warning (no info)",
    0x6281: "Part of data corrupted",
    0x6282: "End of file before Le",
    0x6283: "Selected file deactivated",
    0x6300: "Warning (state unchanged)",
    0x6400: "Exec error (state unchanged)",
    0x6500: "Exec error (memory changed)",
    0x6700: "Wrong length",
    0x6800: "Function not supported",
    0x6881: "Logical channel not supported",
    0x6882: "Secure messaging not supported",
    0x6900: "Command not allowed",
    0x6981: "Incompatible with file structure",
    0x6982: "Security status not satisfied",
    0x6983: "Auth method blocked",
    0x6984: "Reference data not usable",
    0x6985: "Conditions of use not satisfied",
    0x6986: "Command not allowed (no EF)",
    0x6A00: "Wrong params P1-P2",
    0x6A80: "Incorrect data field params",
    0x6A81: "Function not supported",
    0x6A82: "File/application not found",
    0x6A83: "Record not found",
    0x6A84: "Not enough memory",
    0x6A86: "Incorrect P1-P2",
    0x6A88: "Referenced data not found",
    0x6B00: "Wrong params (offset)",
    0x6C00: "Wrong Le field",
    0x6D00: "INS not supported",
    0x6E00: "CLA not supported",
    0x6F00: "No precise diagnosis",
}

# ISO 7816-4 INS codes (common subset)
ISO7816_INS = {
    0xA4: "SELECT",
    0xB0: "READ BINARY",
    0xB2: "READ RECORD",
    0xD6: "UPDATE BINARY",
    0xDC: "UPDATE RECORD",
    0xCA: "GET DATA",
    0xCB: "GET DATA (odd INS)",
    0x20: "VERIFY",
    0x24: "CHANGE PIN",
    0x82: "EXTERNAL AUTHENTICATE",
    0x84: "GET CHALLENGE",
    0x88: "INTERNAL AUTHENTICATE",
    0x70: "MANAGE CHANNEL",
    0xC0: "GET RESPONSE",
    0xA8: "GET PROCESSING OPTIONS",
    0xAE: "GENERATE AC",
}


@dataclass
class ApduCommand:
    """Parsed ISO 7816-4 Command APDU (C-APDU)"""

    cla: int
    ins: int
    p1: int
    p2: int
    lc: Optional[int] = None
    data: Optional[bytes] = None
    le: Optional[int] = None

    @property
    def ins_name(self) -> str:
        """Human-readable INS name"""
        return ISO7816_INS.get(self.ins, f"0x{self.ins:02X}")

    @property
    def is_select(self) -> bool:
        return self.ins == 0xA4

    @property
    def is_read_record(self) -> bool:
        return self.ins == 0xB2

    @property
    def is_get_processing_options(self) -> bool:
        return self.ins == 0xA8


@dataclass
class ApduResponse:
    """Parsed ISO 7816-4 Response APDU (R-APDU)"""

    data: Optional[bytes] = None
    sw1: int = 0
    sw2: int = 0

    @property
    def sw(self) -> int:
        """Combined status word"""
        return (self.sw1 << 8) | self.sw2

    @property
    def sw_name(self) -> str:
        """Human-readable status word"""
        sw = self.sw
        # Exact match
        if sw in STATUS_WORDS:
            return STATUS_WORDS[sw]
        # SW1-only match (SW2 encodes extra info)
        sw1_masked = sw & 0xFF00
        if sw1_masked in STATUS_WORDS:
            return f"{STATUS_WORDS[sw1_masked]} ({self.sw2})"
        # 61XX: SW2 = remaining bytes
        if self.sw1 == 0x61:
            return f"OK, {self.sw2} bytes remaining"
        # 6CXX: SW2 = correct Le
        if self.sw1 == 0x6C:
            return f"Wrong Le, use {self.sw2:02X}"
        return f"0x{sw:04X}"

    @property
    def is_success(self) -> bool:
        return self.sw1 == 0x90 and self.sw2 == 0x00

    @property
    def is_more_data(self) -> bool:
        return self.sw1 == 0x61


def parse_apdu_command(payload: bytes) -> Optional[ApduCommand]:
    """
    Parse a Command APDU (C-APDU) from raw bytes.

    Supports Case 1-4 APDU structures per ISO 7816-4:
      Case 1: CLA INS P1 P2                    (4 bytes)
      Case 2: CLA INS P1 P2 Le                 (5 bytes)
      Case 3: CLA INS P1 P2 Lc Data            (5+Lc bytes)
      Case 4: CLA INS P1 P2 Lc Data Le         (6+Lc bytes)
    """
    if not payload or len(payload) < 4:
        return None

    cla = payload[0]
    ins = payload[1]
    p1 = payload[2]
    p2 = payload[3]

    if len(payload) == 4:
        # Case 1: no Lc, no Le
        return ApduCommand(cla=cla, ins=ins, p1=p1, p2=p2)

    if len(payload) == 5:
        # Case 2: Le only (no data)
        le = payload[4]
        if le == 0:
            le = 256  # Le=0 means 256
        return ApduCommand(cla=cla, ins=ins, p1=p1, p2=p2, le=le)

    # Case 3 or 4: Lc + Data [+ Le]
    lc = payload[4]
    if lc == 0 and len(payload) > 7:
        # Extended length Lc (3-byte): 00 + 2-byte Lc
        lc = (payload[5] << 8) | payload[6]
        data = payload[7 : 7 + lc] if lc > 0 else None
        remainder = payload[7 + lc :]
    else:
        data = payload[5 : 5 + lc] if lc > 0 else None
        remainder = payload[5 + lc :]

    le = None
    if remainder:
        if len(remainder) == 1:
            le = remainder[0]
            if le == 0:
                le = 256
        elif len(remainder) == 2:
            # Extended Le
            le = (remainder[0] << 8) | remainder[1]
            if le == 0:
                le = 65536

    return ApduCommand(cla=cla, ins=ins, p1=p1, p2=p2, lc=lc, data=data, le=le)


def parse_apdu_response(payload: bytes) -> Optional[ApduResponse]:
    """
    Parse a Response APDU (R-APDU) from raw bytes.

    Format: [Data] SW1 SW2
    Minimum 2 bytes (SW1 + SW2 only).
    """
    if not payload or len(payload) < 2:
        return None

    sw1 = payload[-2]
    sw2 = payload[-1]
    data = payload[:-2] if len(payload) > 2 else None

    return ApduResponse(data=data, sw1=sw1, sw2=sw2)


# =============================================================================
# SELECT APDU Decoding
# =============================================================================


@dataclass
class SelectRequest:
    """Decoded ISO 7816-4 SELECT command"""

    apdu: ApduCommand
    selection_type: str  # "by AID", "by ID", "MF", etc.
    aid: Optional[bytes] = None
    aid_name: Optional[str] = None  # Well-known AID name

    def format_short(self) -> str:
        """One-line summary for display"""
        if self.aid_name:
            return f"SELECT {self.aid_name}"
        if self.aid:
            return f"SELECT AID:{self.aid.hex().upper()}"
        return f"SELECT {self.selection_type}"

    def format_detail(self) -> str:
        """Detailed breakdown"""
        parts = [f"SELECT P1:{self.apdu.p1:02X}({self.selection_type})"]
        p2_desc = SELECT_P2_FCI.get(self.apdu.p2 & 0x0C, f"0x{self.apdu.p2:02X}")
        parts.append(f"P2:{self.apdu.p2:02X}({p2_desc})")
        if self.aid:
            parts.append(f"AID:{self.aid.hex().upper()}")
            if self.aid_name:
                parts.append(f"[{self.aid_name}]")
        elif self.apdu.data:
            parts.append(f"Data:{self.apdu.data.hex().upper()}")
        if self.apdu.le is not None:
            parts.append(f"Le:{self.apdu.le}")
        return " ".join(parts)


@dataclass
class SelectResponse:
    """Decoded ISO 7816-4 SELECT response"""

    rapdu: ApduResponse
    fci: Optional[Dict[str, Any]] = None  # Parsed FCI TLV fields
    aid: Optional[bytes] = None  # DF name from FCI (tag 84)
    app_label: Optional[str] = None  # Application label (tag 50)

    def format_short(self) -> str:
        """One-line summary for display"""
        parts = []
        if self.rapdu.is_success:
            if self.app_label:
                parts.append(f"OK [{self.app_label}]")
            elif self.aid:
                aid_hex = self.aid.hex().lower()
                name = KNOWN_AIDS.get(aid_hex)
                parts.append(f"OK AID:{self.aid.hex().upper()}")
                if name:
                    parts.append(f"[{name}]")
            else:
                parts.append("OK")
            if self.rapdu.data:
                parts.append(f"({len(self.rapdu.data)}B)")
        else:
            parts.append(f"SW:{self.rapdu.sw:04X} {self.rapdu.sw_name}")
        return " ".join(parts)

    def format_detail(self) -> str:
        """Detailed breakdown"""
        parts = [f"SW:{self.rapdu.sw:04X}({self.rapdu.sw_name})"]
        if self.fci:
            for tag_name, value in self.fci.items():
                if isinstance(value, bytes):
                    parts.append(f"{tag_name}:{value.hex().upper()}")
                elif isinstance(value, str):
                    parts.append(f"{tag_name}:{value}")
                else:
                    parts.append(f"{tag_name}:{value}")
        elif self.rapdu.data:
            parts.append(f"Data[{len(self.rapdu.data)}B]:{self.rapdu.data.hex().upper()}")
        return " ".join(parts)


# BER-TLV tag names for SELECT response (FCI template)
FCI_TAGS = {
    0x6F: "FCI",
    0x84: "DF_Name",
    0xA5: "FCI_Prop",
    0x50: "AppLabel",
    0x87: "Priority",
    0x9F11: "IssuerCodeIdx",
    0x9F12: "AppPrefName",
    0xBF0C: "FCI_Issuer",
    0x61: "AppTemplate",
    0x4F: "AID",
    0x88: "SFI",
}


def _parse_tlv_tag(data: bytes, offset: int) -> tuple[int, int]:
    """Parse a BER-TLV tag. Returns (tag, new_offset)."""
    if offset >= len(data):
        return 0, offset
    b = data[offset]
    offset += 1
    if (b & 0x1F) == 0x1F:
        # Multi-byte tag
        tag = b
        while offset < len(data):
            b2 = data[offset]
            tag = (tag << 8) | b2
            offset += 1
            if not (b2 & 0x80):
                break
        return tag, offset
    return b, offset


def _parse_tlv_length(data: bytes, offset: int) -> tuple[int, int]:
    """Parse a BER-TLV length. Returns (length, new_offset)."""
    if offset >= len(data):
        return 0, offset
    b = data[offset]
    offset += 1
    if b <= 0x7F:
        return b, offset
    num_bytes = b & 0x7F
    length = 0
    for _ in range(num_bytes):
        if offset >= len(data):
            break
        length = (length << 8) | data[offset]
        offset += 1
    return length, offset


def _is_constructed(tag: int) -> bool:
    """Check if a TLV tag is constructed (contains nested TLVs)."""
    # Get the first byte of the tag
    if tag > 0xFF:
        first_byte = (tag >> 8) & 0xFF
    else:
        first_byte = tag
    return bool(first_byte & 0x20)


def parse_fci_tlv(data: bytes) -> Dict[str, Any]:
    """
    Parse FCI (File Control Information) from a SELECT response.

    Performs a shallow recursive parse of BER-TLV to extract:
    - DF Name (tag 84) — the AID
    - Application Label (tag 50) — human-readable name
    - Priority Indicator (tag 87)
    - Nested constructed tags (6F, A5, BF0C, 61)

    Returns a dict of tag_name -> value pairs.
    """
    result: Dict[str, Any] = {}
    offset = 0

    while offset < len(data):
        tag, offset = _parse_tlv_tag(data, offset)
        if tag == 0:
            break
        length, offset = _parse_tlv_length(data, offset)
        if offset + length > len(data):
            break

        value = data[offset : offset + length]
        offset += length

        tag_name = FCI_TAGS.get(tag, f"Tag_{tag:02X}" if tag <= 0xFF else f"Tag_{tag:04X}")

        if _is_constructed(tag):
            # Recursively parse constructed tags
            nested = parse_fci_tlv(value)
            result.update(nested)
        else:
            # Primitive tags — decode based on type
            if tag in (0x50, 0x9F12):
                # Text fields (Application Label, App Preferred Name)
                try:
                    result[tag_name] = value.decode("ascii", errors="replace")
                except UnicodeDecodeError:
                    result[tag_name] = value
            elif tag == 0x87:
                # Priority indicator (single byte)
                result[tag_name] = value[0] if value else 0
            else:
                result[tag_name] = value

    return result


def decode_select_request(frame: NFCFrame) -> Optional[SelectRequest]:
    """
    Decode a SELECT command from an ISO-DEP I-Block frame.

    Returns SelectRequest if the frame contains a SELECT APDU, None otherwise.
    """
    payload = extract_isodep_payload(frame)
    if not payload:
        return None

    apdu = parse_apdu_command(payload)
    if not apdu or not apdu.is_select:
        return None

    # Determine selection type from P1
    selection_type = SELECT_P1.get(apdu.p1, f"P1=0x{apdu.p1:02X}")

    aid = None
    aid_name = None

    if apdu.p1 == 0x04 and apdu.data:
        # Select by DF name (AID)
        aid = apdu.data
        aid_hex = aid.hex().lower()
        aid_name = KNOWN_AIDS.get(aid_hex)
        # Also try ASCII interpretation for PPSE-like names
        if not aid_name:
            try:
                text = aid.decode("ascii")
                if text.isprintable():
                    aid_name = text
            except (UnicodeDecodeError, ValueError):
                pass
    elif apdu.p1 == 0x00 and apdu.data:
        # Select MF/EF/DF by file ID
        selection_type = "by File ID"
        if apdu.data == b'\x3F\x00':
            selection_type = "MF"

    return SelectRequest(
        apdu=apdu,
        selection_type=selection_type,
        aid=aid,
        aid_name=aid_name,
    )


def decode_select_response(frame: NFCFrame) -> Optional[SelectResponse]:
    """
    Decode a SELECT response from an ISO-DEP I-Block frame.

    Returns SelectResponse if the frame contains a valid R-APDU, None otherwise.
    Note: Without request context, this parses ANY R-APDU. The caller should
    pair it with the preceding SELECT request.
    """
    payload = extract_isodep_payload(frame)
    if not payload:
        return None

    rapdu = parse_apdu_response(payload)
    if not rapdu:
        return None

    fci = None
    aid = None
    app_label = None

    if rapdu.data and rapdu.is_success:
        # Try to parse as FCI TLV
        fci = parse_fci_tlv(rapdu.data)
        if fci:
            # Extract key fields
            aid_val = fci.get("DF_Name") or fci.get("AID")
            if isinstance(aid_val, bytes):
                aid = aid_val
            label_val = fci.get("AppLabel")
            if isinstance(label_val, str):
                app_label = label_val

    return SelectResponse(
        rapdu=rapdu,
        fci=fci,
        aid=aid,
        app_label=app_label,
    )


# =============================================================================
# GENERATE AC (EMV INS 0xAE) Decoding
# =============================================================================

# GENERATE AC P1: Reference Control Parameter
GENERATE_AC_P1_TYPE = {
    0x00: "AAC",    # Application Authentication Cryptogram (decline)
    0x40: "TC",     # Transaction Certificate (approve offline)
    0x80: "ARQC",   # Authorization Request Cryptogram (go online)
}

# Cryptogram Information Data (tag 9F27)
CRYPTOGRAM_TYPE = {
    0x00: "AAC",
    0x40: "TC",
    0x80: "ARQC",
}


@dataclass
class GenerateACRequest:
    """Decoded EMV GENERATE AC command"""

    apdu: ApduCommand
    cryptogram_requested: str  # "TC", "ARQC", "AAC"
    cda_requested: bool  # Combined Data Authentication
    cdol_data: Optional[bytes] = None  # CDOL data (transaction data)

    def format_short(self) -> str:
        """One-line summary"""
        cda_str = "+CDA" if self.cda_requested else ""
        return f"GENERATE AC ({self.cryptogram_requested}{cda_str})"

    def format_detail(self) -> str:
        """Detailed breakdown"""
        parts = [f"GENERATE AC P1:{self.apdu.p1:02X}"]
        cda_str = "+CDA" if self.cda_requested else ""
        parts.append(f"({self.cryptogram_requested}{cda_str})")
        if self.cdol_data:
            parts.append(f"CDOL[{len(self.cdol_data)}B]:{self.cdol_data.hex().upper()}")
        return " ".join(parts)


@dataclass
class GenerateACResponse:
    """Decoded EMV GENERATE AC response"""

    rapdu: ApduResponse
    cryptogram_type: Optional[str] = None  # "TC", "ARQC", "AAC"
    atc: Optional[bytes] = None  # Application Transaction Counter (9F36)
    cryptogram: Optional[bytes] = None  # Application Cryptogram (9F26)
    issuer_app_data: Optional[bytes] = None  # Issuer Application Data (9F10)
    cid: Optional[int] = None  # Cryptogram Information Data (9F27)
    signed_data: Optional[bytes] = None  # Signed Dynamic Application Data (9F4B)
    tlv_fields: Optional[Dict[str, Any]] = None  # All parsed TLV fields

    def format_short(self) -> str:
        """One-line summary"""
        if not self.rapdu.is_success:
            return f"SW:{self.rapdu.sw:04X} {self.rapdu.sw_name}"
        parts = ["OK"]
        if self.cryptogram_type:
            parts.append(f"({self.cryptogram_type})")
        if self.cryptogram:
            parts.append(f"AC:{self.cryptogram.hex().upper()}")
        if self.atc:
            parts.append(f"ATC:{self.atc.hex().upper()}")
        return " ".join(parts)

    def format_detail(self) -> str:
        """Detailed breakdown"""
        parts = [f"SW:{self.rapdu.sw:04X}({self.rapdu.sw_name})"]
        if self.cid is not None:
            ctype = CRYPTOGRAM_TYPE.get(self.cid & 0xC0, f"0x{self.cid:02X}")
            parts.append(f"CID:{self.cid:02X}({ctype})")
        if self.atc:
            # ATC as integer for readability
            atc_val = int.from_bytes(self.atc, "big")
            parts.append(f"ATC:{atc_val}")
        if self.cryptogram:
            parts.append(f"AC:{self.cryptogram.hex().upper()}")
        if self.issuer_app_data:
            if len(self.issuer_app_data) > 16:
                parts.append(f"IAD[{len(self.issuer_app_data)}B]:{self.issuer_app_data[:16].hex().upper()}...")
            else:
                parts.append(f"IAD:{self.issuer_app_data.hex().upper()}")
        if self.signed_data:
            parts.append(f"SDAD[{len(self.signed_data)}B]")
        # Show any extra TLV fields not already displayed
        if self.tlv_fields:
            shown_tags = {"Tag_9F27", "Tag_9F36", "Tag_9F26", "Tag_9F10", "Tag_9F4B"}
            for tag_name, value in self.tlv_fields.items():
                if tag_name not in shown_tags:
                    if isinstance(value, bytes):
                        if len(value) > 8:
                            parts.append(f"{tag_name}[{len(value)}B]")
                        else:
                            parts.append(f"{tag_name}:{value.hex().upper()}")
                    else:
                        parts.append(f"{tag_name}:{value}")
        return " ".join(parts)


# EMV-specific TLV tags for GENERATE AC response
EMV_AC_TAGS = {
    0x9F27: "Tag_9F27",  # Cryptogram Information Data
    0x9F36: "Tag_9F36",  # Application Transaction Counter
    0x9F26: "Tag_9F26",  # Application Cryptogram
    0x9F10: "Tag_9F10",  # Issuer Application Data
    0x9F4B: "Tag_9F4B",  # Signed Dynamic Application Data
    0x9F6C: "Tag_9F6C",  # Mag Stripe Application Version Number
    0x9F6E: "Tag_9F6E",  # Form Factor Indicator
    0xDF8101: "Tag_DF8101",
    0xDF8102: "Tag_DF8102",
    0xDF8104: "Tag_DF8104",
    0xDF8105: "Tag_DF8105",
}


def _parse_emv_tlv(data: bytes) -> Dict[str, Any]:
    """Parse TLV data from a GENERATE AC response (EMV format 2)."""
    result: Dict[str, Any] = {}
    offset = 0

    while offset < len(data):
        tag, offset = _parse_tlv_tag(data, offset)
        if tag == 0 or offset >= len(data):
            break
        length, offset = _parse_tlv_length(data, offset)
        if offset + length > len(data):
            break
        value = data[offset:offset + length]
        offset += length

        # Use known name or generate one
        if tag in EMV_AC_TAGS:
            tag_name = EMV_AC_TAGS[tag]
        elif tag in FCI_TAGS:
            tag_name = FCI_TAGS[tag]
        elif tag <= 0xFF:
            tag_name = f"Tag_{tag:02X}"
        elif tag <= 0xFFFF:
            tag_name = f"Tag_{tag:04X}"
        else:
            tag_name = f"Tag_{tag:06X}"

        result[tag_name] = value

    return result


def decode_generate_ac_request(frame: NFCFrame) -> Optional[GenerateACRequest]:
    """
    Decode a GENERATE AC command from an ISO-DEP I-Block frame.

    Returns GenerateACRequest if the frame contains a GENERATE AC APDU.
    """
    payload = extract_isodep_payload(frame)
    if not payload:
        return None

    apdu = parse_apdu_command(payload)
    if not apdu or apdu.ins != 0xAE:
        return None

    # P1 bits 7-6: cryptogram type requested
    # Bit 4: CDA requested
    p1_type = apdu.p1 & 0xC0
    cryptogram_requested = GENERATE_AC_P1_TYPE.get(p1_type, f"Unknown(0x{p1_type:02X})")
    cda_requested = bool(apdu.p1 & 0x10)

    return GenerateACRequest(
        apdu=apdu,
        cryptogram_requested=cryptogram_requested,
        cda_requested=cda_requested,
        cdol_data=apdu.data,
    )


def decode_generate_ac_response(frame: NFCFrame) -> Optional[GenerateACResponse]:
    """
    Decode a GENERATE AC response from an ISO-DEP I-Block frame.

    EMV responses use either Format 1 (tag 80) or Format 2 (tag 77) TLV.
    """
    payload = extract_isodep_payload(frame)
    if not payload:
        return None

    rapdu = parse_apdu_response(payload)
    if not rapdu:
        return None

    cryptogram_type = None
    atc = None
    cryptogram = None
    issuer_app_data = None
    cid = None
    signed_data = None
    tlv_fields = None

    if rapdu.data and rapdu.is_success:
        data = rapdu.data

        # Check for Format 1 (tag 80) or Format 2 (tag 77)
        if len(data) >= 2:
            if data[0] == 0x80:
                # Format 1: fixed layout CID(1) + ATC(2) + AC(8) + IAD(var)
                _, off = _parse_tlv_length(data, 1)
                inner = data[off:]
                if len(inner) >= 11:
                    cid = inner[0]
                    cryptogram_type = CRYPTOGRAM_TYPE.get(cid & 0xC0, f"0x{cid:02X}")
                    atc = inner[1:3]
                    cryptogram = inner[3:11]
                    if len(inner) > 11:
                        issuer_app_data = inner[11:]
            elif data[0] == 0x77:
                # Format 2: constructed TLV
                _, off = _parse_tlv_length(data, 1)
                inner = data[off:]
                tlv_fields = _parse_emv_tlv(inner)

                # Extract known fields
                cid_val = tlv_fields.get("Tag_9F27")
                if isinstance(cid_val, bytes) and len(cid_val) >= 1:
                    cid = cid_val[0]
                    cryptogram_type = CRYPTOGRAM_TYPE.get(cid & 0xC0, f"0x{cid:02X}")
                atc_val = tlv_fields.get("Tag_9F36")
                if isinstance(atc_val, bytes):
                    atc = atc_val
                ac_val = tlv_fields.get("Tag_9F26")
                if isinstance(ac_val, bytes):
                    cryptogram = ac_val
                iad_val = tlv_fields.get("Tag_9F10")
                if isinstance(iad_val, bytes):
                    issuer_app_data = iad_val
                sdad_val = tlv_fields.get("Tag_9F4B")
                if isinstance(sdad_val, bytes):
                    signed_data = sdad_val
            else:
                # Try generic TLV parse
                tlv_fields = _parse_emv_tlv(data)

    return GenerateACResponse(
        rapdu=rapdu,
        cryptogram_type=cryptogram_type,
        atc=atc,
        cryptogram=cryptogram,
        issuer_app_data=issuer_app_data,
        cid=cid,
        signed_data=signed_data,
        tlv_fields=tlv_fields,
    )



def detect_command(frame: NFCFrame) -> Optional[str]:
    """
    Detect protocol command name from frame data.

    This is a best-effort, stateless detection. Response frames
    (ATQA, SAK, UID, ATS, etc.) cannot be reliably detected without
    context from previous Poll frames.

    Args:
        frame: NFCFrame to analyze

    Returns:
        Command name string if recognized, None otherwise

    Example:
        >>> frame = NFCFrame(...)  # NFC-A WUPA
        >>> detect_command(frame)
        'WUPA'
    """
    if not frame.data or len(frame.data) == 0:
        return None

    # Strip CRC for NFC-A/B/V to improve detection accuracy
    if frame.tech in ("NfcA", "NfcB", "NfcV"):
        data, _ = _strip_crc_if_present(frame.data)
    else:
        data = frame.data
    length = len(data)

    result = None

    # NFC-A: Special cases first, then table lookup
    if frame.tech == "NfcA":
        cmd = data[0]

        # HLTA (0x50 0x00) - must check second byte to distinguish from HLTB
        if cmd == 0x50 and length >= 2 and data[1] == 0x00:
            result = "HLTA"

        # AUTH_A/AUTH_B (MIFARE Classic) - conflicts with GET_VERSION (0x60)
        # Heuristic: length > 2 → AUTH, else GET_VERSION
        elif cmd == 0x60 and length >= 2:
            result = "AUTH_A" if length > 2 else NFC_A_COMMANDS.get(cmd)
        elif cmd == 0x61 and length >= 2:
            result = "AUTH_B"

        # PPS (0xD0-0xDF) - PPSS + PPS0 minimum, optional PPS1/PPS2/PPS3/CID
        elif (cmd & 0xF0) == 0xD0 and length >= 2:
            result = "PPS"

        # Cascade levels (0x93/0x95/0x97) - NVB determines mode
        elif cmd in (0x93, 0x95, 0x97) and length >= 2:
            level = {0x93: "1", 0x95: "2", 0x97: "3"}[cmd]
            nvb = data[1]
            if nvb == 0x70:
                result = f"SELECT{level}"
            elif (nvb & 0xF0) == 0x20:
                result = f"ANTICOLLISION{level}"
            else:
                result = f"SEL{level}"

        # Table lookup for remaining commands
        else:
            result = NFC_A_COMMANDS.get(cmd)

    # NFC-B: Table lookup, then SLOT_MARKER for Poll frames
    elif frame.tech == "NfcB":
        cmd = data[0]
        result = NFC_B_COMMANDS.get(cmd)
        # Slot markers (0x00-0x0F) only in Poll frames
        if result is None and frame.is_poll() and 0x00 <= cmd <= 0x0F:
            result = "SLOT_MARKER"

    # NFC-F: Command in second byte (first byte is length)
    # Responses use CMD+1 (e.g., POLLING 0x00 → response 0x01)
    elif frame.tech == "NfcF":
        if length >= 2:
            cmd = data[1]
            if frame.is_poll():
                result = NFC_F_COMMANDS.get(cmd)
            else:
                # Response: map back to request (CMD-1)
                request_cmd = (cmd - 1) & 0xFF
                cmd_name = NFC_F_COMMANDS.get(request_cmd)
                result = f"{cmd_name}-Resp" if cmd_name else None

    # NFC-V: Command in second byte (first byte is flags)
    elif frame.tech == "NfcV":
        if length >= 2 and frame.is_poll():
            result = NFC_V_COMMANDS.get(data[1])

    # ISO 7816 T=1: PCB-based block structure
    elif frame.tech == "Iso7816":
        if length >= 1:
            pcb = data[0]
            # I-Block: bit 7 = 0
            if (pcb & 0x80) == 0x00:
                result = "I-Block"
            # R-Block: bits 7-6 = 10
            elif (pcb & 0xC0) == 0x80:
                result = "R-Block"
            # S-Block: bits 7-6 = 11
            elif (pcb & 0xC0) == 0xC0:
                result = "S-Block"

    # ISO-DEP (ISO/IEC 14443-4) on top of NFC-A/B
    # Only if nothing recognized yet and frame is Poll/Listen
    if (
        result is None
        and frame.tech in ("NfcA", "NfcB")
        and (frame.is_poll() or frame.is_listen())
    ):
        pcb = data[0]

        # S(DESELECT): PCB 0xC2/0xCA
        if (pcb & 0xF7) == 0xC2:
            return "S(DESELECT)"

        # S(WTX): PCB 0xF2/0xFA
        if (pcb & 0xF7) == 0xF2:
            return "S(WTX)"

        # R(ACK): bit 4 = 0
        if (pcb & 0xE6) == 0xA2:
            return "R(ACK)"

        # R(NACK): bit 4 = 1
        if (pcb & 0xE6) == 0xB2:
            return "R(NACK)"

        # I-Block: bit 7 = 0 — try to identify the APDU command
        if (pcb & ISO_DEP_I_BLOCK_MASK) == 0x00:
            # Check chaining bit — if set, this is a fragment
            if pcb & 0x10:
                return "I-Block(chained)"
            apdu_payload = extract_isodep_payload(frame)
            if apdu_payload and frame.is_poll() and len(apdu_payload) >= 4:
                apdu = parse_apdu_command(apdu_payload)
                if apdu:
                    return apdu.ins_name
            return "I-Block"

    return result
