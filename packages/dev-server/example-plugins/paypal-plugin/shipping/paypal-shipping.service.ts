import { Injectable } from '@nestjs/common';
import { PatchOp, ShipmentCarrier } from '@paypal/paypal-server-sdk';
import { Logger } from '@vendure/core';
import { getOrdersController } from '../paypal-client';

const loggerCtx = 'PayPalShippingService';

export interface AddShipmentTrackingInput {
    /** The PayPal capture ID for the order being shipped. */
    captureId: string;
    /** Shipment tracking number from the carrier. */
    trackingNumber?: string;
    /** PayPal carrier enum value, e.g. "UPS", "FEDEX", "USPS". Use "OTHER" + carrierNameOther for unlisted carriers. */
    carrier?: string;
    /** Required when carrier is "OTHER". */
    carrierNameOther?: string;
    /** When true PayPal emails the buyer with tracking details. */
    notifyPayer?: boolean;
}

export interface ShipmentTrackingResult {
    /** PayPal tracker ID — format returned directly by PayPal after tracker creation. */
    trackerId: string;
    status: string;
}

/** Extracts a human-readable message from a PayPal SDK ApiError. */
function paypalErrorMessage(err: unknown): string {
    if (err && typeof err === 'object') {
        const e = err as Record<string, unknown>;
        // ApiError exposes .result (parsed JSON body) and .statusCode
        const result = e['result'] as Record<string, unknown> | undefined;
        if (result) {
            const details = Array.isArray(result['details'])
                ? (result['details'] as Array<Record<string, unknown>>)
                      .map(d => `${d['issue'] ?? ''}: ${d['description'] ?? ''}`.trim())
                      .join('; ')
                : undefined;
            const base = `${result['name'] ?? ''} — ${result['message'] ?? ''}`.trim();
            return details ? `${base} | ${details}` : base;
        }
        if (typeof e['message'] === 'string' && e['message']) return e['message'];
    }
    return String(err);
}

@Injectable()
export class PayPalShippingService {
    /**
     * Attaches shipment tracking to a captured PayPal order.
     * Returns the PayPal tracker ID which can later be used to cancel tracking.
     */
    async addShipmentTracking(
        orderId: string,
        input: AddShipmentTrackingInput,
    ): Promise<ShipmentTrackingResult> {
        const ctrl = getOrdersController();

        Logger.info(
            `PayPal addShipmentTracking — Order: ${orderId}, CaptureId: ${input.captureId}, ` +
            `Carrier: ${input.carrier ?? 'none'}, TrackingNumber: ${input.trackingNumber ?? 'none'}`,
            loggerCtx,
        );

        let response;
        try {
            response = await ctrl.createOrderTracking({
                id: orderId,
                body: {
                    captureId: input.captureId,
                    trackingNumber: input.trackingNumber,
                    carrier: input.carrier as ShipmentCarrier | undefined,
                    carrierNameOther: input.carrierNameOther,
                    notifyPayer: input.notifyPayer ?? false,
                },
            });
        } catch (err) {
            const msg = paypalErrorMessage(err);
            const status = (err as Record<string, unknown>)['statusCode'];
            Logger.error(
                `PayPal createOrderTracking failed. Order: ${orderId}, HTTP ${status ?? '?'}: ${msg}`,
                loggerCtx,
            );
            throw new Error(`PayPal tracking error (HTTP ${status ?? '?'}): ${msg}`);
        }

        const order = response.result;
        Logger.debug(
            `PayPal createOrderTracking raw response — Order: ${orderId}, ` +
            `PurchaseUnits: ${JSON.stringify(order.purchaseUnits?.map(u => u.shipping))}`,
            loggerCtx,
        );

        // Tracker ID is nested in the first purchase unit's shipping trackers array
        const tracker = order.purchaseUnits?.[0]?.shipping?.trackers?.[0];
        if (!tracker?.id) {
            Logger.warn(
                `PayPal accepted the tracking submission for order ${orderId} but returned no tracker ID. ` +
                `Full purchase units: ${JSON.stringify(order.purchaseUnits)}`,
                loggerCtx,
            );
            throw new Error(
                `PayPal accepted tracking for order ${orderId} but did not return a tracker ID.`,
            );
        }

        Logger.info(
            `PayPal shipment tracking added. Order: ${orderId}, Tracker ID: ${tracker.id}, Status: ${tracker.status}`,
            loggerCtx,
        );

        return { trackerId: tracker.id, status: tracker.status ?? 'SHIPPED' };
    }

    /**
     * Cancels shipment tracking on a PayPal order.
     * The only supported status transition via the update API is → CANCELLED.
     *
     * trackerId must be the exact string returned by addShipmentTracking (from PayPal's
     * response), which PayPal formats as "<captureId>-<trackingNumber>".
     */
    async cancelShipmentTracking(orderId: string, trackerId: string): Promise<void> {
        const ctrl = getOrdersController();

        Logger.info(
            `PayPal cancelShipmentTracking — Order: ${orderId}, Tracker ID: ${trackerId}`,
            loggerCtx,
        );

        try {
            await ctrl.updateOrderTracking({
                id: orderId,
                // The SDK URL-encodes the trackerId into /v2/checkout/orders/{id}/trackers/{trackerId}
                trackerId,
                body: [
                    {
                        op: PatchOp.Replace,
                        path: '/status',
                        value: 'CANCELLED',
                    },
                ],
            });
        } catch (err) {
            const msg = paypalErrorMessage(err);
            const status = (err as Record<string, unknown>)['statusCode'];
            Logger.error(
                `PayPal updateOrderTracking failed. Order: ${orderId}, Tracker: ${trackerId}, ` +
                `HTTP ${status ?? '?'}: ${msg}`,
                loggerCtx,
            );
            throw new Error(`PayPal cancel tracking error (HTTP ${status ?? '?'}): ${msg}`);
        }

        Logger.info(
            `PayPal shipment tracking cancelled. Order: ${orderId}, Tracker ID: ${trackerId}`,
            loggerCtx,
        );
    }
}
