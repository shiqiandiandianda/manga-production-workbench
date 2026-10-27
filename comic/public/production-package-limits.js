// Production packages retain their complete source files. Do not impose a
// product-level file, package or transport size cap; format and digest checks remain.
export const PRODUCTION_PACKAGE_LIMITS=Object.freeze({files:Infinity,bytes:Infinity,fileBytes:Infinity,requestBytes:Infinity,projectImportBytes:Infinity});
