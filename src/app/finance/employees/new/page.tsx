import { redirect } from 'next/navigation';

// Los empleados ahora se crean en /settings/employees. La página de
// "nuevo empleado" de payroll ya no existe — el trigger crea el stub
// automáticamente al insertar en employees, y el admin llena los datos
// de nómina después desde /finance/employees.
export default function NewFinanceEmployeePage() {
    redirect('/finance/employees?info=create-in-settings');
}
