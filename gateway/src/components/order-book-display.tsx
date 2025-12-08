"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OrderBookSnapshot, VenueOrderBook } from "@/hooks/use-order-book-websocket";

type Props = {
  orderBook: OrderBookSnapshot | null;
};

function VenueOrderBookTable({ venue }: { venue: VenueOrderBook | undefined }) {
  if (!venue) {
    return (
      <div className="h-96 flex items-center justify-center text-muted-foreground">
        <p>暂无数据</p>
      </div>
    );
  }

  const formatPrice = (price: number) => `$${price.toFixed(2)}`;
  const formatSize = (size: number) => size.toFixed(4);

  return (
    <div className="space-y-4">
      {/* Asks (Sell Orders) */}
      <div>
        <h4 className="text-sm font-semibold text-red-600 mb-2">卖单 (Asks)</h4>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">价格</TableHead>
                <TableHead className="text-right">数量</TableHead>
                <TableHead className="text-right">累计</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {venue.asks.levels.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="h-24 text-center text-sm text-muted-foreground">
                    暂无卖单
                  </TableCell>
                </TableRow>
              ) : (
                [...venue.asks.levels].reverse().slice(0, 10).map((level, idx) => (
                  <TableRow key={`ask-${idx}`} className="hover:bg-red-50/50">
                    <TableCell className="text-right font-mono text-red-600">
                      {formatPrice(level.price)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatSize(level.size)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {formatSize(level.total)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Bids (Buy Orders) */}
      <div>
        <h4 className="text-sm font-semibold text-green-600 mb-2">买单 (Bids)</h4>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">价格</TableHead>
                <TableHead className="text-right">数量</TableHead>
                <TableHead className="text-right">累计</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {venue.bids.levels.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="h-24 text-center text-sm text-muted-foreground">
                    暂无买单
                  </TableCell>
                </TableRow>
              ) : (
                venue.bids.levels.slice(0, 10).map((level, idx) => (
                  <TableRow key={`bid-${idx}`} className="hover:bg-green-50/50">
                    <TableCell className="text-right font-mono text-green-600">
                      {formatPrice(level.price)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatSize(level.size)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {formatSize(level.total)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

export function OrderBookDisplay({ orderBook }: Props) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Drift 订单簿</CardTitle>
        </CardHeader>
        <CardContent>
          <VenueOrderBookTable venue={orderBook?.drift} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Lighter 订单簿</CardTitle>
        </CardHeader>
        <CardContent>
          <VenueOrderBookTable venue={orderBook?.lighter} />
        </CardContent>
      </Card>
    </div>
  );
}
