'use strict';
//
// Parsing for the WebSocket -> KNX direction.
//
// Extracted from app.js so it can be tested without opening any socket.
// The accepted formats are a contract with external clients (Bitfocus
// Companion, the phone remote) - read PROTOCOL.md before changing any of
// them. This module only decides what is accepted; it never sends.
//
// Before this existed, a malformed frame terminated the whole process and
// the hall lost lighting control until the 01:00 cron or a reboot. Every
// rejection below replaces a crash. Keep it that way: reject, never throw.
//
const GROUP_ADDRESS = /^\d+\/\d+\/\d+$/;

// The original parser treated the literal string 'undefined' and the empty
// string as "absent", because clients build frames by concatenation and can
// send either. Preserved deliberately.
function isSet(token) {
    return token !== undefined && token !== null && token !== 'undefined' && token !== '';
}

function asJson(raw) {
    try {
        var json = JSON.parse(raw);
        return (json && typeof json === 'object') ? json : null;
    } catch (e) {
        return null;
    }
}

// Everything that reaches the bus must survive eibd.str2addr() and
// parseFloat(). A frame that fails here used to be a process-ending
// TypeError inside an async callback.
function validate(message) {
    if (!message || typeof message !== 'object') {
        return 'not an object';
    }
    if (!isSet(message.dst_addr) || !GROUP_ADDRESS.test(String(message.dst_addr))) {
        return 'missing or malformed dst_addr';
    }
    if (!isSet(message.dpt_type)) {
        return 'missing dpt_type';
    }
    if (!isSet(message.value)) {
        return 'missing value';
    }
    return null;
}

//
// parse(raw, translator)
//   -> { message: {dst_addr, dpt_type, value} }  frame is safe to send
//   -> { rejected: '<reason>' }                  frame is not, and why
//
function parse(raw, translator) {
    var problem;

    // JSON is tried first, as it always has been. It used to be forwarded to
    // the bus with no validation at all, so {"foo":1} was enough to kill the
    // bridge.
    var json = asJson(raw);
    if (json) {
        problem = validate(json);
        return problem ? { rejected: 'JSON frame: ' + problem } : { message: json };
    }

    var tokens = String(raw).trim().split(' ');
    var verb = isSet(tokens[0]) ? tokens[0].trim().toUpperCase() : '';
    if (!verb) {
        return { rejected: 'empty frame' };
    }

    var message = null;

    switch (verb) {
        case 'SCENE':
            if (!isSet(tokens[1])) {
                // This exact frame - the bare word SCENE - was a reproducible
                // way to terminate the bridge.
                return { rejected: 'SCENE without a name' };
            }
            var name = tokens[1].trim().toUpperCase();
            var entry = null;
            for (var i = 0; i < translator.length; i++) {
                if (translator[i].name.trim().toUpperCase() === name) {
                    entry = translator[i];
                    break;
                }
            }
            if (!entry) {
                return { rejected: 'SCENE with unknown name: ' + tokens[1] };
            }
            // Preserved quirk: an explicit value overwrites the entry's stored
            // value for the lifetime of the process, as a string. A client may
            // depend on it, so it stays until the Companion operator is asked.
            // Documented in PROTOCOL.md.
            if (isSet(tokens[2])) {
                entry.value = tokens[2];
            }
            message = entry;
            break;

        case 'ADDR':
            if (!isSet(tokens[1])) {
                return { rejected: 'ADDR without an address' };
            }
            if (!isSet(tokens[2])) {
                return { rejected: 'ADDR without a value' };
            }
            // ADDR is always DPT1 - there is no way to send another type with it.
            message = { dst_addr: tokens[1], dpt_type: 'DPT1', value: tokens[2] };
            break;

        default:
            return { rejected: 'unknown command: ' + verb };
    }

    problem = validate(message);
    return problem ? { rejected: verb + ': ' + problem } : { message: message };
}

exports.PARSER_parse = parse;
exports.PARSER_validate = validate;
