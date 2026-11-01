// Native stand-ins for OHIF primitives; browser acceptance uses the actual pinned UI bundle.
import React from 'react';
export const Button=({variant,...props})=><button {...props}/>;
export const Input=props=><input {...props}/>;
export const Dialog=()=>null;
export const DialogContent=()=>null;
export const DialogHeader=()=>null;
export const DialogTitle=()=>null;
export const DialogDescription=()=>null;
export const DialogFooter=()=>null;
