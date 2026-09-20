'use strict';
//
// What the bridge can honestly say about itself.
//
// Every value here is either measured or absent. Nothing is inferred: a
// dashboard that guesses is worse than one with a gap in it, because a gap
// prompts a question and a guess ends one.
//
const fs = require('fs');

const USB_DEVICES = '/sys/bus/usb/devices';
const KNX_VENDOR = '28c2';   // MEAN WELL
const KNX_PRODUCT = '0013';  // KNX-USB interface

const started_at = Date.now();

// Read straight from sysfs rather than shelling out to lsusb: no dependency on
// usbutils being installed, and nothing to escape. Returns null - not false -
// when the question cannot be answered, e.g. on a machine without sysfs.
function usbPresent() {
    let entries;
    try {
        entries = fs.readdirSync(USB_DEVICES);
    } catch (e) {
        return null;
    }
    for (const entry of entries) {
        try {
            const vendor = fs.readFileSync(USB_DEVICES + '/' + entry + '/idVendor', 'utf8').trim();
            if (vendor !== KNX_VENDOR) {
                continue;
            }
            const product = fs.readFileSync(USB_DEVICES + '/' + entry + '/idProduct', 'utf8').trim();
            if (product === KNX_PRODUCT) {
                return true;
            }
        } catch (e) {
            // Not every entry under /sys/bus/usb/devices is a device with these
            // files - interfaces and hubs are in there too. Skip quietly.
        }
    }
    return false;
}

//
// report(facts) -> ['HEALTH KNXD 1', 'HEALTH USB 1', ...]
//
// The three-token shape is the same one used for bus events, so a client parses
// it with the code it already has, and one that never asks sees nothing new.
// A value that cannot be determined is reported as -1, never as 0: "no" and
// "do not know" are different answers.
//
function report(facts) {
    const usb = usbPresent();
    const lines = [
        ['KNXD', facts.knxd_connected ? 1 : 0],
        ['LISTENER', facts.listening ? 1 : 0],
        ['USB', usb === null ? -1 : (usb ? 1 : 0)],
        ['CLIENTS', facts.clients],
        ['UPTIME', Math.round((Date.now() - started_at) / 1000)],
        ['ADDRESSES', facts.addresses],
        ['KNOWN', facts.known],
        // Seconds since the last telegram the bridge saw. -1 means it has not
        // seen one yet, which after a restart is normal rather than alarming.
        ['LASTBUS', facts.last_bus_at ? Math.round((Date.now() - facts.last_bus_at) / 1000) : -1],
    ];
    return lines.map(([name, value]) => 'HEALTH ' + name + ' ' + value);
}

exports.HEALTH_report = report;
exports.HEALTH_usbPresent = usbPresent;
