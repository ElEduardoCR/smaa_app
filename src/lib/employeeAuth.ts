/** Only these known roles can sign in by selecting their user. */
export function requiresEmployeePassword(role: string): boolean {
    return role !== 'operator' && role !== 'document_controller' && role !== 'top_management';
}
