import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Vouchers from "./pages/Vouchers";
import Customers from "./pages/Customers";
import Items from "./pages/Items";
import ImportPage from "./pages/Import";
import Settings from "./pages/Settings";
import Orders from "./pages/Orders";
import AdvancedOrders from "./pages/AdvancedOrders";
import { UnitsProvider } from "./context/UnitsContext";

export default function App() {
  return (
    <UnitsProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/vouchers" element={<Vouchers />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/items" element={<Items />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/advanced-orders" element={<AdvancedOrders />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </UnitsProvider>
  );
}
