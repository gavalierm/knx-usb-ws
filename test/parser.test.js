'use strict';
//
// Contract tests for the WebSocket -> KNX parser.
//
// These assert the message formats documented in PROTOCOL.md. That document
// is a contract with an external consumer (Bitfocus Companion, maintained by
// a different operator), so a failing test here means a client breaks - not
// that the test is out of date. Read PROTOCOL.md before changing any of them.
//
// Run: node --test          (no dependencies, uses the built-in test runner)
//
const test = require('node:test');
const assert = require('node:assert');
const { PARSER_parse } = require('../services/parser');

// Fresh copy per test: SCENE deliberately mutates the table it is given.
function translator() {
    return [
        { name: 'central', dst_addr: '0/0/1', dpt_type: 'DPT1' },
        { name: 'schody', dst_addr: '0/1/0', dpt_type: 'DPT1' },
        { name: 'sala', dst_addr: '0/3/0', dpt_type: 'DPT1' },
        { name: 'scene', dst_addr: '1/0/0', dpt_type: 'DPT5' },
        { name: 'uvod', dst_addr: '1/0/0', dpt_type: 'DPT5', value: 0 },
        { name: 'chvaly', dst_addr: '1/1/0', dpt_type: 'DPT5', value: 1 },
    ];
}

test('ADDR builds a DPT1 write', () => {
    const { message } = PARSER_parse('ADDR 0/0/1 1', translator());
    assert.deepStrictEqual(message, { dst_addr: '0/0/1', dpt_type: 'DPT1', value: '1' });
});

test('ADDR accepts value 0', () => {
    const { message } = PARSER_parse('ADDR 0/3/0 0', translator());
    assert.strictEqual(message.value, '0');
});

test('verbs and scene names are case-insensitive', () => {
    assert.ok(PARSER_parse('addr 0/0/1 1', translator()).message);
    assert.strictEqual(PARSER_parse('Scene CHVALY', translator()).message.dst_addr, '1/1/0');
});

test('SCENE resolves a name to its address and stored value', () => {
    const { message } = PARSER_parse('SCENE chvaly', translator());
    assert.strictEqual(message.dst_addr, '1/1/0');
    assert.strictEqual(message.dpt_type, 'DPT5');
    assert.strictEqual(message.value, 1);
});

test('SCENE with an explicit value overwrites the stored one (documented quirk)', () => {
    const table = translator();
    PARSER_parse('SCENE chvaly 5', table);
    const { message } = PARSER_parse('SCENE chvaly', table);
    assert.strictEqual(message.value, '5', 'the overwrite outlives the frame, by design');
});

//
// Everything below used to terminate the process.
//

test('bare SCENE is rejected, not fatal', () => {
    // Reproduced crash: TypeError reading 'trim' of undefined.
    const { message, rejected } = PARSER_parse('SCENE', translator());
    assert.strictEqual(message, undefined);
    assert.match(rejected, /SCENE without a name/);
});

test('SCENE with an unknown name is rejected', () => {
    // A mistyped Companion button reached str2addr(undefined) and threw.
    const { rejected } = PARSER_parse('SCENE nosuchscene', translator());
    assert.match(rejected, /unknown name/);
});

test('an unknown verb is rejected', () => {
    const { rejected } = PARSER_parse('HELLO there', translator());
    assert.match(rejected, /unknown command/);
});

test('ADDR without a value is rejected', () => {
    assert.match(PARSER_parse('ADDR 0/0/1', translator()).rejected, /without a value/);
});

test('ADDR without an address is rejected', () => {
    assert.match(PARSER_parse('ADDR', translator()).rejected, /without an address/);
});

test('ADDR with a malformed address is rejected', () => {
    assert.match(PARSER_parse('ADDR garbage 1', translator()).rejected, /dst_addr/);
});

test('the literal string "undefined" counts as absent', () => {
    // Clients build frames by concatenation and do send this.
    assert.ok(PARSER_parse('ADDR 0/0/1 undefined', translator()).rejected);
});

test('an empty frame is rejected', () => {
    assert.match(PARSER_parse('', translator()).rejected, /empty frame/);
    assert.ok(PARSER_parse('   ', translator()).rejected);
});

test('valid JSON passes through', () => {
    const raw = '{"dst_addr":"0/0/1","dpt_type":"DPT1","value":1}';
    const { message } = PARSER_parse(raw, translator());
    assert.deepStrictEqual(message, { dst_addr: '0/0/1', dpt_type: 'DPT1', value: 1 });
});

test('JSON without a usable address is rejected', () => {
    // Previously forwarded to the bus unvalidated - {"foo":1} was enough.
    assert.match(PARSER_parse('{"foo":1}', translator()).rejected, /JSON frame/);
    assert.match(PARSER_parse('{"dst_addr":"nope","dpt_type":"DPT1","value":1}', translator()).rejected, /dst_addr/);
});

test('no input shape makes the parser throw', () => {
    for (const raw of ['', ' ', 'SCENE', 'ADDR', 'x', '{}', '[]', 'null', '0', '{"a":', 'SCENE  ']) {
        assert.doesNotThrow(() => PARSER_parse(raw, translator()), `threw on ${JSON.stringify(raw)}`);
    }
});
